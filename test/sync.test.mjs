import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sync } from '../src/sync.mjs'
test('sync rejects pull request events and using the default branch as its destination',async()=>{
 const event={repository:{default_branch:'trunk'}}
 for(const [name,branch] of [['pull_request','sync'],['workflow_dispatch','trunk']]){
  await assert.rejects(sync({GITHUB_EVENT_NAME:name,ACTION_BRANCH:branch},event),/trusted repository workflow|Invalid delivery branch/)
 }
})
