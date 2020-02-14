import { ProviderFn } from './types';
import Harmony from './harmony';
import { ExtensionManifest } from './extension-manifest';

export type ExtensionProps<Conf> = {
  name: string;
  // TODO: changes from any to something meaningful
  dependencies: any[];
  config: Conf;
  provider: ProviderFn<Conf>;
};

/**
 * harmony's extension definition. this can be used to define and extend `Harmony` applications.
 */
export class Extension<Conf = {}> {
  constructor(
    /**
     * manifest of the extension.
     */
    readonly manifest: ExtensionManifest
  ) {}

  private _instance = null;

  private _loaded = false;

  /**
   * returns the instance of the extension
   */
  get instance() {
    return this._instance;
  }

  get name() {
    return this.manifest.name;
  }

  get config() {
    return this.manifest.config || {};
  }

  get dependencies() {
    return this.manifest.dependencies || [];
  }

  get provider() {
    return this.manifest.provider;
  }

  /**
   * returns an indication of the extension already loaded (the provider run)
   * We don't rely on the instance since an extension provider might return null
   */
  get loaded() {
    return this._loaded;
  }

  /**
   * initiate Harmony in run-time.
   */
  async run<Conf>(dependencies: any[], harmony: Harmony<Conf>, config?: Conf) {
    if (!this.loaded) {
      // @ts-ignore TODO: doron please fix (:
      const instance = await this.provider(config || this.manifest.config, dependencies, harmony);
      this._instance = instance;
      this._loaded = true;
      return instance;
    }

    return Promise.resolve(this.instance);
  }
}
