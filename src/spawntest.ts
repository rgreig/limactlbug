import { spawn } from 'child_process';
import LimaBackend from './lima';
const controller = new AbortController();
const { signal } = controller;

async function spawntest() {

  let i = 0;

  // let promises = [];


  // for (i = 0; i < 60; i++) {
  //   const limactl = spawn('/Users/u806869/dev/rancher-desktop/resources/darwin/lima/bin/limactl',
  //                         ['--debug', 'shell', '0', 'sleep', '5'],
  //                         { signal, stdio: ['ignore', 'pipe', 'pipe'] });
  //   limactl.stdout.on('data', (data) => {
  //     console.log(`stdout: ${data}`);
  //   });

  //   limactl.stderr.on('data', (data) => {
  //     console.error(`stderr: ${data}`);
  //   });

  //   limactl.on('error', (err) => {
  //     console.error(`error: ${err}`);
  //   });

  //   limactl.on('close', (code) => {
  //     console.log(`child process exited with code ${code}`);
  //   });
  //   promises.push(limactl);
  // }

  // await Promise.all(promises);

  const lima: LimaBackend = new LimaBackend();
  for (i = 0; i < 50; i++) {
    console.log('***** Starting block ' + i);
    await lima.runTest3();
    console.log('***** Completed block ' + i);    
  }
  console.log('Done test');
}



spawntest();
console.log('Done main');
