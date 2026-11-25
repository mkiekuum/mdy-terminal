// Each request loads the installed transport, even when the host keeps this stdio process open across upgrades.
import readline from 'node:readline';
import {Worker} from 'node:worker_threads';

function forward(input) {
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./stdio-transport.mjs',import.meta.url),{workerData:{input,paired:process.argv.includes('--paired')}});
    worker.once('message',body=>{resolve(body);worker.terminate();});
    worker.once('error',reject);
    worker.once('exit',()=>reject(Error('Transport closed without a response')));
  });
}
for await(const line of readline.createInterface({input:process.stdin})) {
  let input;
  try {
    input=JSON.parse(line);
    const body=await forward(input);
    if(body) console.log(JSON.stringify(body));
  } catch {
    if(input?.id!==undefined) console.log(JSON.stringify({jsonrpc:'2.0',id:input.id,
      error:{code:-32000,message:'TRANSPORT_UNAVAILABLE: 请检查便携包完整性，执行结果未知时先查询原回执。'}}));
  }
}
