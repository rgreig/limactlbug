import os from 'os';
import fs from 'fs';
import path from 'path';
import paths from './paths';
import stream from 'stream';
import tar from 'tar-stream';
import util from 'util';
import yaml from 'yaml';

import semver from 'semver';

import * as childProcess from './utils/childProcess';
import Logging from './utils/logging';
import getSystemCertificates from './utils/certs';
import { defined, RecursiveReadonly } from './utils/typeUtils';

import NETWORKS_CONFIG from '@/assets/networks-config.yaml';

//import { Settings } from './config/settings';

const console = Logging.lima;
const MACHINE_NAME = '0';

interface LimaNetworkConfiguration {
    paths: {
        vdeSwitch: string;
        vdeVMNet: string;
        varRun: string;
        sudoers?: string;
    }
    group?: string;
    networks: Record<string, {
        mode: 'host' | 'shared';
        gateway: string;
        dhcpEnd: string;
        netmask: string;
    } | {
        mode: 'bridged';
        interface: string;
    }>;
}

interface LimaListResult {
    name: string;
    status: 'Broken' | 'Stopped' | 'Running';
    dir: string;
    arch: 'x86_64' | 'aarch64';
    sshLocalPort?: number;
    hostAgentPID?: number;
    qemuPID?: number;
    errors?: string[];
}

/**
 * Enumeration for tracking what operation the backend is undergoing.
 */
enum Action {
    NONE = 'idle',
    STARTING = 'starting',
    STOPPING = 'stopping',
}

export default class LimaBackend { //extends events.EventEmitter {

    debug = false;
    k8sVersion: semver.SemVer = new semver.SemVer("1.24.3");

    protected readonly CONFIG_PATH = path.join(paths.lima, '_config', `${MACHINE_NAME}.yaml`);

  //  protected cfg: RecursiveReadonly<Settings['kubernetes']> | undefined;


    // constructor() {
    //     super();
    // }

    public async runTest3(): Promise<void> {

        await this.startVM();

        try {
            await Promise.all([
                this.installTrivy(),
                this.installCACerts()
            ]).catch(reason => {
                console.error('Error running test:', reason);
            });
        }
        catch (err) {
            console.error('Error running test:', err);
        }
        console.log('************** Done within runTest3');
    }

    protected static get limactl() {
        return path.join(paths.resources, os.platform(), 'lima', 'bin', 'limactl');
    }

    protected static get limaEnv() {
        const binDir = path.join(paths.resources, os.platform(), 'lima', 'bin');
        const pathList = (process.env.PATH || '').split(path.delimiter);
        const newPath = [binDir].concat(...pathList).filter(x => x);

        return {
            ...process.env, ELECTRON_NO_ASAR: '1', LIMA_HOME: paths.lima, PATH: newPath.join(path.delimiter)
        };
    }

    protected async limaWithCapture(this: Readonly<this>, ...args: string[]): Promise<string> {
        args = this.debug ? ['--debug'].concat(args) : args;
        try {
            const { stdout, stderr } = await childProcess.spawnFile(LimaBackend.limactl, args,
                { env: LimaBackend.limaEnv, stdio: ['ignore', 'pipe', 'pipe'] });
            const formatBreak = stderr || stdout ? '\n' : '';

            console.log(`> limactl ${args.join(' ')}${formatBreak}${stderr}${stdout}`);

            return stdout;
        } catch (ex) {
            console.error(`> limactl ${args.join(' ')}\n$`, ex);
            throw ex;
        }
    }

    protected async writeFile(filePath: string, fileContents: string, permissions: fs.Mode = 0o644) {
        const workdir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `rd-${path.basename(filePath)}-`));
        const tempPath = `/tmp/${path.basename(workdir)}.${path.basename(filePath)}`;

        try {
            const scriptPath = path.join(workdir, path.basename(filePath));

            await fs.promises.writeFile(scriptPath, fileContents, 'utf-8');
            await this.lima('copy', scriptPath, `${MACHINE_NAME}:${tempPath}`);
            await this.ssh('chmod', permissions.toString(8), tempPath);
            await this.ssh('sudo', 'mv', tempPath, filePath);
        } finally {
            await fs.promises.rm(workdir, { recursive: true });
            await this.ssh('sudo', 'rm', '-f', tempPath);
        }
    }

    protected async writeConf(service: string, settings: Record<string, string>) {
        const contents = Object.entries(settings).map(([key, value]) => `${key}="${value}"\n`).join('');

        await this.writeFile(`/etc/conf.d/${service}`, contents);
    }

    protected async ssh(...args: string[]): Promise<void> {
        await this.lima('shell', '--workdir=.', MACHINE_NAME, ...args);
    }

    protected async lima(this: Readonly<this>, ...args: string[]): Promise<void> {
        args = this.debug ? ['--debug'].concat(args) : args;
        try {
            const { stdout, stderr } = await childProcess.spawnFile(LimaBackend.limactl, args,
                { env: LimaBackend.limaEnv, stdio: ['ignore', 'pipe', 'pipe'] });
            const formatBreak = stderr || stdout ? '\n' : '';

            console.log(`> limactl ${args.join(' ')}${formatBreak}${stderr}${stdout}`);
        } catch (ex) {
            console.error(`> limactl ${args.join(' ')}\n$`, ex);
            throw ex;
        }
    }

    protected async installTrivy() {
        const trivyPath = path.join(paths.resources, 'linux', 'internal', 'trivy');

        await this.lima('copy', trivyPath, `${MACHINE_NAME}:./trivy`);
        await this.ssh('sudo', 'mv', './trivy', '/usr/local/bin/trivy');
    }

    protected async installCACerts(): Promise<void> {
        const certs: string[] = [];

        for await (const cert of getSystemCertificates()) {
            certs.push(cert);
        }

        const workdir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rd-ca-'));

        try {
            await this.ssh('sudo', '/bin/sh', '-c', 'rm -f /usr/local/share/ca-certificates/rd-*.crt');

            if (certs && certs.length > 0) {
                const writeStream = fs.createWriteStream(path.join(workdir, 'certs.tar'));
                const archive = tar.pack();
                const archiveFinished = util.promisify(stream.finished)(archive);

                archive.pipe(writeStream);

                for (const [index, cert] of certs.entries()) {
                    const curried = archive.entry.bind(archive, {
                        name: `rd-${index}.crt`,
                        mode: 0o600,
                    }, cert);

                    await util.promisify(curried)();
                }
                archive.finalize();
                await archiveFinished;

                await this.lima('copy', path.join(workdir, 'certs.tar'), `${MACHINE_NAME}:/tmp/certs.tar`);
                await this.ssh('sudo', 'tar', 'xf', '/tmp/certs.tar', '-C', '/usr/local/share/ca-certificates/');
            }
        } finally {
            await fs.promises.rm(workdir, { recursive: true, force: true });
        }
        await this.ssh('sudo', 'update-ca-certificates');
    }

    protected async startVM() {

        await this.installCustomLimaNetworkConfig();
        try {
            await this.lima('start', '--tty=false', await this.isRegistered ? MACHINE_NAME : this.CONFIG_PATH);
        } finally {
            // Symlink the logs (especially if start failed) so the users can find them
            const machineDir = path.join(paths.lima, MACHINE_NAME);

            // Start the process, but ignore the result.
            fs.promises.readdir(machineDir)
                .then(filenames => filenames.filter(x => x.endsWith('.log'))
                    .forEach(filename => fs.promises.symlink(
                        path.join(path.relative(paths.logs, machineDir), filename),
                        path.join(paths.logs, `lima.${filename}`))
                        .catch(() => { })));
            try {
                await fs.promises.rm(this.CONFIG_PATH, { force: true });
            } catch (e) {
                console.debug(`Failed to delete ${this.CONFIG_PATH}: ${e}`);
            }
        }
    }

    protected async installCustomLimaNetworkConfig() {
        const networkPath = path.join(paths.lima, '_config', 'networks.yaml');

        let config: LimaNetworkConfiguration;

        try {
            config = yaml.parse(await fs.promises.readFile(networkPath, 'utf8'));
            if (config?.paths?.varRun !== NETWORKS_CONFIG.paths.varRun) {
                const backupName = networkPath.replace(/\.yaml$/, '.orig.yaml');

                await fs.promises.rename(networkPath, backupName);
                console.log(`Lima network configuration has unexpected contents; existing file renamed as ${backupName}.`);
                config = NETWORKS_CONFIG;
            }
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
                console.log(`Existing networks.yaml file ${networkPath} not yaml-parsable, got error ${err}. It will be replaced.`);
            }
            config = NETWORKS_CONFIG;
        }

        if (config.group === 'staff') {
            config.group = 'everyone';
        }

        for (const key of Object.keys(config.networks)) {
            if (key.startsWith('rancher-desktop-bridged_')) {
                delete config.networks[key];
            }
        }

        delete config.paths.sudoers;

        await fs.promises.writeFile(networkPath, yaml.stringify(config), { encoding: 'utf-8' });
    }

    protected get isRegistered(): Promise<boolean> {
        return this.status.then(defined);
    }

    protected get status(): Promise<LimaListResult | undefined> {
        return (async () => {
            try {
                const text = await this.limaWithCapture('list', '--json');
                const lines = text.split(/\r?\n/).filter(x => x.trim());
                const entries = lines.map(line => JSON.parse(line) as LimaListResult);

                return entries.find(entry => entry.name === MACHINE_NAME);
            } catch (ex) {
                console.error('Could not parse lima status, assuming machine is unavailable.');

                return undefined;
            }
        })();
    }
}