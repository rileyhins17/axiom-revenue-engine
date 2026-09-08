import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium, type Browser } from "playwright";
import { legacyClientMailFixture } from "./fixtures/legacy-client-mail";
import { legacyBoundary } from "./fixtures/legacy-mail-boundary";
import { handleSavedEmailHistory } from "../src/lib/revenue-engine/saved-email-history";

let stage = "setup";
/** Actual server-page props and full ClientProfile/viewer components. Synthetic
 * HTTP authentication and in-memory source schema only; no app sign-in proof. */
async function main() {
  const root = resolve(".");
  assert.equal(root.replaceAll("\\","/").toLowerCase(),"c:/users/riley/documents/chatgpt/ape");
  const f = legacyClientMailFixture();
  let browser: Browser | undefined;
  let unavailable = false;
  const external: string[] = [], errors: string[] = [], methods: string[] = [];
  const cssNames = readdirSync(resolve(".next/static"),{recursive:true}).filter((name): name is string => typeof name === "string" && name.endsWith(".css"));
  assert(cssNames.length,"Build first; no concurrently running builds/dry runs");
  const css = cssNames.map(name => readFileSync(resolve(".next/static",name),"utf8")).join("\n");
  const bundle = await build({write:false,bundle:true,platform:"browser",format:"iife",jsx:"automatic",
    define:{"process.env.NODE_ENV":'"production"',"process.env":"{}"},stdin:{loader:"tsx",resolveDir:root,contents:`
      import React from "react";
      import {createRoot} from "react-dom/client";
      import {ClientProfile} from "./src/components/ClientProfile";
      import {SentEmailViewerTrigger} from "./src/components/sent-email-viewer";
      const root=createRoot(document.getElementById("app"));
      fetch("/fixture-profile").then(r=>r.json()).then(props=>root.render(<>
        <ClientProfile {...props}/><SentEmailViewerTrigger emailId="owner-email">Open legacy message viewer</SentEmailViewerTrigger>
      </>));
    `}});
  const server = createServer(async(req,res)=>{
    try {
      methods.push(req.method??"");
      if(req.method!=="GET"){res.writeHead(405).end();return;}
      const url=new URL(req.url??"/","http://127.0.0.1");
      if(url.pathname==="/"){
        res.setHeader("Content-Type","text/html; charset=utf-8");
        res.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Legacy client mail — local synthetic verification</title><link rel="stylesheet" href="/style.css"></head><body style="background:#09090b;color:#e4e4e7;padding:16px"><main id="app"></main><script src="/fixture.js"></script></body></html>');
      }else if(url.pathname==="/fixture.js"){
        res.setHeader("Content-Type","application/javascript");res.end(bundle.outputFiles[0].text);
      }else if(url.pathname==="/style.css"){
        res.setHeader("Content-Type","text/css");res.end(css);
      }else if(url.pathname==="/fixture-profile"){
        res.setHeader("Content-Type","application/json");res.end(JSON.stringify(await legacyBoundary(f,"page")()));
      }else if(url.pathname==="/api/outreach/emails/owner-email"){
        if(unavailable){res.writeHead(503).end();return;}
        const response=await legacyBoundary(f,"detail")("owner-email") as Response;
        res.writeHead(response.status,Object.fromEntries(response.headers.entries()));res.end(await response.text());
      }else if(url.pathname==="/api/clients/1/emails"){
        const response=await handleSavedEmailHistory(new Request(url),"1",f.actor,()=>f.database);
        res.writeHead(response.status,Object.fromEntries(response.headers.entries()));res.end(await response.text());
      }else{res.writeHead(204).end();}
    }catch(error){console.error("Synthetic fixture server:",error instanceof Error ? error.message : "unknown");res.writeHead(500).end("Synthetic fixture unavailable");}
  });
  try{
    const changes=f.changes();
    await new Promise<void>(done=>server.listen(0,"127.0.0.1",done));
    const address=server.address();assert(address&&typeof address!=="string");
    const origin=`http://127.0.0.1:${address.port}`;
    browser=await chromium.launch({headless:true});
    const context=await browser.newContext({reducedMotion:"reduce"});
    await context.route("**/*",async route=>{
      if(new URL(route.request().url()).origin===origin)await route.continue();
      else{external.push(route.request().url());await route.abort();}
    });
    const page=await context.newPage();
    page.on("pageerror",error=>{errors.push(error.message);console.error("Synthetic browser:",error.message);});
    const output=resolve("output/playwright/legacy-email-history");mkdirSync(output,{recursive:true});
    for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
      stage=`profile ${viewport.width}`;
      await page.setViewportSize(viewport);await page.goto(origin);
      stage=`profile notes ${viewport.width}`;
      await page.getByText("Preserved CRM note",{exact:true}).waitFor();
      stage=`saved panel ${viewport.width}`;
      await page.getByText("No saved outgoing replies for this client. This does not mean their inbox is empty.",{exact:true}).waitFor();
      const disclosure=page.getByRole("button").filter({has:page.getByText("owner legacy subject",{exact:true})});
      stage=`disclosure ${viewport.width}`;
      await disclosure.focus();await page.keyboard.press("Enter");
      await page.getByText('owner legacy text <img src="https://tracking.invalid/plain-text">',{exact:true}).waitFor();
      const text=await page.locator("body").innerText();
      stage=`profile privacy ${viewport.width}`;
      assert.doesNotMatch(text,/other legacy subject|private-provider-error|private sequence body/);
      assert.equal(await page.locator("img,iframe").count(),0);
      stage=`profile overflow ${viewport.width}`;
      await page.screenshot({path:resolve(output,viewport.width>1000?"desktop-profile.png":"mobile-profile.png"),fullPage:true});
      if(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth)) {
        console.error("Synthetic overflow elements",await page.evaluate(()=>Array.from(document.querySelectorAll("main *")).filter(e=>e.getBoundingClientRect().right>window.innerWidth).slice(0,12).map(e=>({tag:e.tagName,class:e.className,right:e.getBoundingClientRect().right}))));
      }
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,"Profile horizontal overflow");
      await page.screenshot({path:resolve(output,viewport.width>1000?"desktop-profile.png":"mobile-profile.png"),fullPage:true});
      stage=`viewer ${viewport.width}`;
      await page.getByRole("button",{name:"Open legacy message viewer",exact:true}).click();
      const modal=page.getByRole("dialog");
      await modal.getByText('owner legacy text <img src="https://tracking.invalid/plain-text">',{exact:true}).waitFor();
      assert.equal(await modal.locator("img,iframe").count(),0);
      assert.equal(await modal.getByText("Delivered",{exact:true}).count(),0);
      await page.screenshot({path:resolve(output,viewport.width>1000?"desktop-viewer.png":"mobile-viewer.png")});
      await page.keyboard.press("Escape");await modal.waitFor({state:"detached"});
      unavailable=true;
      await page.getByRole("button",{name:"Open legacy message viewer",exact:true}).click();
      await modal.getByText(/This legacy message is unavailable/).waitFor();
      assert.equal(await modal.getByText("owner legacy subject",{exact:true}).count(),0);
      await page.keyboard.press("Escape");unavailable=false;
    }
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert(methods.every(method=>method==="GET"));
    assert.equal(f.changes(),changes);
    console.log("Legacy mail browser gate passed: actual client page props, full profile and viewer on desktop/mobile, keyboard disclosure, error clearing, owner isolation, plaintext safety; zero external requests or database writes.");
  }finally{
    await browser?.close();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));f.close();
  }
}
main().catch(error=>{console.error(`Legacy mail browser gate failed at ${stage}: ${error instanceof Error ? error.name : "Unknown error"}; no private data logged.`);process.exitCode=1;});
