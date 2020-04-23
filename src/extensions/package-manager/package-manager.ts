/* eslint-disable no-empty */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
import path, { join } from 'path';
import fs from 'fs-extra';
import pMapSeries from 'p-map-series';
import execa from 'execa';
import librarian from 'librarian';
import { Logger, LogPublisher } from '../logger';
import { Capsule } from '../isolator/capsule';
import { pipeOutput } from '../../utils/child_process';
import createSymlinkOrCopy from '../../utils/fs/create-symlink-or-copy';

export type installOpts = {
  packageManager?: string;
};

function linkBitBinInCapsule(capsule) {
  const bitBinPath = path.join(capsule.wrkDir, './node_modules/bit-bin');
  const localBitBinPath = path.join(__dirname, '../..');
  // if there are no deps, sometimes the node_modules folder is not created
  // and we need it in order to perform the linking
  try {
    capsule.fs.mkdirSync('node_modules');
  } catch (e) {
    // fail silently - we only need to create it if it doesn't already exist
  }
  // we use fs directly here rather than the capsule.fs because there are some edge cases
  // that the capusle fs does not deal with well (eg. identifying and deleting
  // a symlink rather than the what the symlink links to)
  fs.removeSync(bitBinPath);
  createSymlinkOrCopy(localBitBinPath, bitBinPath);
}

export default class PackageManager {
  constructor(readonly packageManagerName: string, readonly logger: Logger) {}

  get name() {
    return this.packageManagerName;
  }
  async checkIfFileExistsInCapsule(capsule: Capsule, file: string) {
    const pathToFile = join(capsule.wrkDir, file);
    try {
      await capsule.fs.promises.access(pathToFile);
      return true;
    } catch (e) {}
    return false;
  }

  async removeLockFilesInCapsule(capsule: Capsule) {
    async function safeUnlink(toRemove: string) {
      try {
        await capsule.fs.promises.unlink(join(capsule.wrkDir, toRemove));
      } catch (e) {}
    }
    await safeUnlink('yarn.lock');
    await safeUnlink('package-lock.json');
    await safeUnlink('librarian-manifests.json');
  }
  async runInstall(capsules: Capsule[], opts: installOpts = {}) {
    const packageManager = opts.packageManager || this.packageManagerName;
    const logPublisher = this.logger.createLogPublisher('packageManager');
    if (packageManager === 'librarian') {
      return librarian.runMultipleInstalls(capsules.map(cap => cap.wrkDir));
    }
    if (packageManager === 'npm' || packageManager === 'yarn') {
      // Don't run them in parallel (Promise.all), the package-manager doesn't handle it well.
      await pMapSeries(capsules, async capsule => {
        // TODO: remove this hack once harmony supports ownExtensionName
        const componentId = capsule.component.id.toString();
        const installProc =
          packageManager === 'npm'
            ? execa('npm', ['install', '--no-package-lock'], { cwd: capsule.wrkDir, stdio: 'pipe' })
            : execa('yarn', [], { cwd: capsule.wrkDir, stdio: 'pipe' });
        logPublisher.info(componentId, packageManager === 'npm' ? '$ npm install --no-package-lock' : '$ yarn'); // TODO: better
        logPublisher.info(componentId, '');
        installProc.stdout!.on('data', d => logPublisher.info(componentId, d.toString()));
        installProc.stderr!.on('data', d => logPublisher.warn(componentId, d.toString()));
        installProc.on('error', e => {
          console.log('error:', e); // eslint-disable-line no-console
          logPublisher.error(componentId, e);
        });
        await installProc;
        linkBitBinInCapsule(capsule);
      });
    } else {
      throw new Error(`unsupported package manager ${packageManager}`);
    }
    return null;
  }

  async runInstallInFolder(folder: string, opts: installOpts = {}) {
    // TODO: remove this hack once harmony supports ownExtensionName
    const logPublisher: LogPublisher = this.logger.createLogPublisher('packageManager');
    const packageManager = opts.packageManager || this.packageManagerName;
    if (packageManager === 'librarian') {
      const child = librarian.runInstall(folder, { stdio: 'pipe' });
      await new Promise((resolve, reject) => {
        child.stdout.on('data', d => logPublisher.info(folder, d.toString()));
        // @ts-ignore
        child.stderr.on('data', d => logPublisher.warn(folder, d.toString()));
        child.on('error', e => reject(e));
        child.on('close', () => {
          // TODO: exit status
          resolve();
        });
      });
      return null;
    }
    if (packageManager === 'yarn') {
      const child = execa('yarn', [], { cwd: folder, stdio: 'pipe' });
      pipeOutput(child);
      await child;
      return null;
    }
    if (packageManager === 'npm') {
      const child = execa('npm', ['install'], { cwd: folder, stdio: 'pipe' });
      logPublisher.info(folder, '$ npm install');
      logPublisher.info(folder, '');
      await new Promise((resolve, reject) => {
        // @ts-ignore
        child.stdout.on('data', d => logPublisher.info(folder, d.toString()));
        // @ts-ignore
        child.stderr.on('data', d => logPublisher.warn(folder, d.toString()));
        child.on('error', e => {
          reject(e);
        });
        child.on('close', exitStatus => {
          if (exitStatus) {
            reject(new Error(`${folder}`));
          } else {
            resolve();
          }
        });
      });
      return null;
    }
    throw new Error(`unsupported package manager ${packageManager}`);
  }
}
