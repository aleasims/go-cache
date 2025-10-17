import * as core from "@actions/core";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

import { CacheProvider, getCmdOutput } from "./utils";

const HOME = os.homedir();

const STATE_CONFIG = "GO_CACHE_CONFIG";
const HASH_LENGTH = 8;

export class CacheConfig {
  public goEnv: GoEnv = new GoEnv();

  /** All the paths we want to cache */
  public cachePaths: Array<string> = [];
  /** The primary cache key */
  public cacheKey = "";
  /** The secondary (restore) key that only contains the prefix and environment */
  public restoreKey = "";

  /** Whether to cache $GOBIN */
  public cacheBin: boolean = true;

  // /** The workspace configurations */
  // public workspaces: Array<Workspace> = [];

  /** Go Module paths */
  public modules: Array<string> = [];

  /** The prefix portion of the cache key */
  private keyPrefix = "";
  /** The Go version considered for the cache key */
  private keyGo = "";
  /** The environment variables considered for the cache key */
  private keyEnvs: Array<string> = [];
  /** The files considered for the cache key */
  private keyFiles: Array<string> = [];

  private constructor() {}

  /**
   * Constructs a [`CacheConfig`] with all the paths and keys.
   *
   * This will read the action `input`s, and read and persist `state` as necessary.
   */
  static async new(): Promise<CacheConfig> {
    const self = new CacheConfig();
    const goEnv = await GoEnv.new();

    // Construct key prefix:
    // This uses either the `shared-key` input,
    // or the `key` input combined with the `job` key.

    let key = core.getInput("prefix-key") || "v0-go";

    const sharedKey = core.getInput("shared-key");
    if (sharedKey) {
      key += `-${sharedKey}`;
    } else {
      const inputKey = core.getInput("key");
      if (inputKey) {
        key += `-${inputKey}`;
      }

      const job = process.env.GITHUB_JOB;
      if (job) {
        key += `-${job}`;
      }
    }

    // Add runner OS and CPU architecture to the key to avoid cross-contamination of cache
    const runnerOS = os.type();
    const runnerArch = os.arch();
    key += `-${runnerOS}-${runnerArch}`;

    self.keyPrefix = key;

    // Construct environment portion of the key:
    // This consists of a hash that considers the Go version
    // as well as all the environment variables as given by a default list
    // and the `env-vars` input.
    // The env vars are sorted, matched by prefix and hashed into the
    // resulting environment hash.

    let hasher = crypto.createHash("sha1");

    let keyGo = `${goEnv.GOVERSION} ${goEnv.GOHOSTARCH} ${goEnv.GOHOSTARCH}`;
    hasher.update(keyGo);

    self.keyGo = keyGo;

    // these prefixes should cover most of the compiler / Go keys
    const envPrefixes = ["CC", "CFLAGS", "CXX", "CMAKE", "GO", "CGO"];
    envPrefixes.push(...core.getInput("env-vars").split(/\s+/).filter(Boolean));

    // sort the available env vars so we have a more stable hash
    const keyEnvs = [];
    const envKeys = Object.keys(process.env);
    envKeys.sort((a, b) => a.localeCompare(b));
    for (const key of envKeys) {
      const value = process.env[key];
      if (envPrefixes.some((prefix) => key.startsWith(prefix)) && value) {
        hasher.update(`${key}=${value}`);
        keyEnvs.push(key);
      }
    }

    self.keyEnvs = keyEnvs;

    key += `-${digest(hasher)}`;

    self.restoreKey = key;

    // Construct the lockfiles portion of the key:
    // This considers all the files found via globbing for various manifests
    // and lockfiles.

    self.cacheBin = core.getInput("cache-bin").toLowerCase() == "true";

    // Construct modules config
    // The modules are given as a newline separated list of paths.
    const modules: Array<string> = [];
    const modulesInput = core.getInput("modules") || ".";
    for (const module of modulesInput.trim().split("\n")) {
      const root = path.resolve(module);
      modules.push(root);
    }

    let keyFiles = [];

    hasher = crypto.createHash("sha1");

    for (const module of modules) {
      const cargo_lock = path.join(module, "go.mod");
      keyFiles.push(cargo_lock);
    }
    keyFiles = sort_and_uniq(keyFiles);

    for (const file of keyFiles) {
      for await (const chunk of fs.createReadStream(file)) {
        hasher.update(chunk);
      }
    }

    let lockHash = digest(hasher);

    self.keyFiles = sort_and_uniq(keyFiles);

    key += `-${lockHash}`;
    self.cacheKey = key;

    self.cachePaths = [goEnv.GOCACHE, goEnv.GOMODCACHE];
    if (self.cacheBin) {
      self.cachePaths = [
        goEnv.GOBIN,
        ...self.cachePaths,
      ];
    }

    const cacheDirectories = core.getInput("cache-directories");
    for (const dir of cacheDirectories.trim().split(/\s+/).filter(Boolean)) {
      self.cachePaths.push(dir);
    }

    return self;
  }

  /**
   * Reads and returns the cache config from the action `state`.
   *
   * @throws {Error} if the state is not present.
   * @returns {CacheConfig} the configuration.
   * @see {@link CacheConfig#saveState}
   * @see {@link CacheConfig#new}
   */
  static fromState(): CacheConfig {
    const source = core.getState(STATE_CONFIG);
    if (!source) {
      throw new Error("Cache configuration not found in state");
    }

    const self = new CacheConfig();
    Object.assign(self, JSON.parse(source));

    return self;
  }

  /**
   * Prints the configuration to the action log.
   */
  printInfo(cacheProvider: CacheProvider) {
    core.startGroup("Cache Configuration");
    core.info(`Cache Provider:`);
    core.info(`    ${cacheProvider.name}`);
    core.info(`Modules:`);
    for (const mod of this.modules) {
      core.info(`    ${mod}`);
    }
    core.info(`Cache Paths:`);
    for (const path of this.cachePaths) {
      core.info(`    ${path}`);
    }
    core.info(`Restore Key:`);
    core.info(`    ${this.restoreKey}`);
    core.info(`Cache Key:`);
    core.info(`    ${this.cacheKey}`);
    core.info(`.. Prefix:`);
    core.info(`  - ${this.keyPrefix}`);
    core.info(`.. Environment considered:`);
    core.info(`  - Go Version: ${this.keyGo}`);
    for (const env of this.keyEnvs) {
      core.info(`  - ${env}`);
    }
    core.info(`.. Lockfiles considered:`);
    for (const file of this.keyFiles) {
      core.info(`  - ${file}`);
    }
    core.endGroup();
  }

  /**
   * Saves the configuration to the state store.
   * This is used to restore the configuration in the post action.
   */
  saveState() {
    core.saveState(STATE_CONFIG, this);
  }
}

/**
 * Checks if the cache is up to date.
 *
 * @returns `true` if the cache is up to date, `false` otherwise.
 */
export function isCacheUpToDate(): boolean {
  return core.getState(STATE_CONFIG) === "";
}

/**
 * Returns a hex digest of the given hasher truncated to `HASH_LENGTH`.
 *
 * @param hasher The hasher to digest.
 * @returns The hex digest.
 */
function digest(hasher: crypto.Hash): string {
  return hasher.digest("hex").substring(0, HASH_LENGTH);
}

class GoEnv {
  public GOARCH: string = "";
  public GOBIN: string = "";
  public GOCACHE: string = "";
  public GOENV: string = "";
  public GOHOSTARCH: string = "";
  public GOHOSTOS: string = "";
  public GOMODCACHE: string = "";
  public GOOS: string = "";
  public GOPATH: string = "";
  public GOVERSION: string = "";

  public constructor() {}

  /** 
   * Create new env reading from `go env` and setting default values.
   *
   * E.g. if GOBIN is not set, it will be defaulted to GOPATH/bin
   */
  static async new(): Promise<GoEnv> {
    const output = await getCmdOutput("go", ["env", "-json"]);
    let goEnv: GoEnv = JSON.parse(output);
    if (goEnv.GOPATH === "") {
      goEnv.GOPATH = path.join(HOME, "go");
    }
    if (goEnv.GOBIN === "") {
      goEnv.GOBIN = path.join(goEnv.GOPATH, "bin");
    }
    if (goEnv.GOMODCACHE === "") {
      goEnv.GOMODCACHE = path.join(goEnv.GOPATH, "pkg", "mod");
    }
    if (goEnv.GOCACHE === "") {
      goEnv.GOCACHE = path.join(HOME, ".cache", "go-build")
    }
    return goEnv;
  }
}

function sort_and_uniq(a: string[]) {
  return a
    .sort((a, b) => a.localeCompare(b))
    .reduce((accumulator: string[], currentValue: string) => {
      const len = accumulator.length;
      // If accumulator is empty or its last element != currentValue
      // Since array is already sorted, elements with the same value
      // are grouped together to be continugous in space.
      //
      // If currentValue != last element, then it must be unique.
      if (len == 0 || accumulator[len - 1].localeCompare(currentValue) != 0) {
        accumulator.push(currentValue);
      }
      return accumulator;
    }, []);
}
