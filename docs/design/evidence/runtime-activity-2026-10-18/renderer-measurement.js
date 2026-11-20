// Run with playwright-cli run-code --filename after opening the owned, completed fixture.
async (page) => {
  const url=page.url();
  if(!/^http:\/\/127\.0\.0\.1:\d+\/#chat-/.test(url))throw new Error('Unexpected fixture');
  const cdp=await page.context().newCDPSession(page); await cdp.send('Performance.enable');
  const rows=[];
  for(let i=0;i<10;i++){
    const begin=Date.now();
    await page.reload();
    await page.getByText('Done: 1',{exact:true}).waitFor();
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const metrics=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x=>[x.name,x.value]));
    const structure=await page.evaluate(()=>({navigation:performance.getEntriesByType('navigation')[0]?.toJSON(),domNodes:document.querySelectorAll('*').length,toolCards:[...document.querySelectorAll('summary')].filter(e=>e.textContent.includes('increment_counter')).length,reasoningBlocks:[...document.querySelectorAll('summary')].filter(e=>e.textContent.toLowerCase().includes('reasoning summary')).length}));
    if(structure.toolCards!==1||structure.reasoningBlocks!==2)throw new Error('History structure changed');
    rows.push({cohort:i<2?'warmup':i%2?'candidate':'baseline',readyMs:Date.now()-begin,taskDurationMs:metrics.TaskDuration*1000,scriptDurationMs:metrics.ScriptDuration*1000,layoutDurationMs:metrics.LayoutDuration*1000,recalcStyleDurationMs:metrics.RecalcStyleDuration*1000,heapBytes:metrics.JSHeapUsedSize,domNodes:structure.domNodes,toolCards:structure.toolCards,reasoningBlocks:structure.reasoningBlocks,navigationDurationMs:structure.navigation?.duration});
  }
  await cdp.detach();
  return {schemaVersion:1,browser:page.context().browser().version(),url,method:'Alternating warmed history reloads, same production fixture and same frozen main application bytes; candidate changes harness/docs only. No app performance improvement claimed.',rows};
}
