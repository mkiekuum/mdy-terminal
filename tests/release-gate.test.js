import test from 'node:test';
import assert from 'node:assert/strict';
import {requireCurrentRelease} from '../mcp/relay.mjs';
import {VERSION} from '../extension/core.js';

test('rechecks official release for each call and fails closed on a stale version or outage',async()=>{
 let version=VERSION;
 const metadata=async()=>({status:200,url:'https://github.com/mkiekuum/mdy-terminal/releases/tag/v'+version});
 await requireCurrentRelease(metadata);
 version='99.0.0';
 await assert.rejects(requireCurrentRelease(metadata),/请升级/);
 await assert.rejects(requireCurrentRelease(async()=>{throw Error('offline');}),/无法确认/);
});
