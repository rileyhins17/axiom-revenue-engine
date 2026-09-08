import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

test("retired console scheduler cannot dispatch work even with old flags, credentials and bindings", async () => {
  const requests: {url:string;authorization:string}[] = [];
  const pending: Promise<unknown>[] = [];
  const exports: {default?:{
    scheduled:(controller:unknown,env:unknown,ctx:unknown)=>void;
    fetch:(request:Request,env:unknown,ctx:unknown)=>Promise<Response>;
  }; BucketCachePurge?:unknown; DOQueueHandler?:unknown; DOShardedTagCache?:unknown} = {};
  const consoleRequest = new Request("https://fixture.example.invalid/leads");
  const consoleEnv = {};
  const consoleContext = {};
  const bindings: unknown[] = [];
  let cacheClears = 0;
  const openNext = {__esModule:true, BucketCachePurge:class {}, DOQueueHandler:class {}, DOShardedTagCache:class {},
    default:{async fetch(request:Request,env:unknown,ctx:unknown){
      assert.equal(request,consoleRequest); assert.equal(env,consoleEnv); assert.equal(ctx,consoleContext);
      return new Response("console preserved");
    }},
  };
  const source = ts.transpileModule(readFileSync("worker.mjs","utf8"),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},
  }).outputText;
  runInNewContext(source, {
    exports, AbortController, setTimeout, clearTimeout, console:{log(){},warn(){},error(){}},
    require(name:string){
      if(name==="./.open-next/worker.js") return openNext;
      if(name==="./src/lib/cloudflare") return {setCloudflareBindings(value:unknown){bindings.push(value);}};
      if(name==="./src/lib/env") return {clearServerEnvCache(){cacheClears++;}};
      throw new Error(`Unexpected test import: ${name}`);
    },
  },{timeout:1000});
  await exports.default!.scheduled({}, {
    APP_BASE_URL:"https://fixture.example.invalid",MCP_API_TOKEN:"synthetic-shared-token",
    AUTONOMOUS_QUEUE_ENABLED:true,AUTONOMOUS_SEND_ENABLED:true,
    AUTONOMOUS_INTAKE_ENABLED:true,CLOUD_SCRAPE_ENABLED:true,
    WORKER_SELF_REFERENCE:{async fetch(url:string, options:{headers:{Authorization:string}}){
      requests.push({url,authorization:options.headers.Authorization});
      return new Response("synthetic");
    }},
  },{waitUntil(promise:Promise<unknown>){pending.push(promise);}});
  await Promise.all(pending);
  assert.equal(requests.length,0);
  assert.equal(pending.length,0);
  assert(!source.includes("MCP_API_TOKEN"));
  assert(!source.includes("cron-timeouts"));
  assert.equal(cacheClears,0);
  assert.deepEqual(bindings,[]);
  const response = await exports.default!.fetch(consoleRequest,consoleEnv,consoleContext);
  assert.equal(await response.text(),"console preserved");
  assert.equal(cacheClears,1);
  assert.deepEqual(bindings,[consoleEnv]);
  for(const name of ["BucketCachePurge","DOQueueHandler","DOShardedTagCache"] as const)
    assert.equal(exports[name],openNext[name]);
});
