// All identifiers below are server identifiers. Titles and business numbers can repeat.
export function planAccess(session,record,listed) {
  const owner=record.current.planOwner===session.actor;
  const admin=session.role==='admin';
  const collaborator=(record.collaborators||[]).includes(session.actor);
  const assistant=listed?.assistantEditable===true;
  const enabled=Boolean(session.actor)&&!session.mustChangePassword;
  return {owner,admin,assistant,collaborator,canManage:enabled&&(admin||owner),
    canEdit:enabled&&(admin||owner||assistant||collaborator),canReview:enabled&&admin};
}

export function branchMap(current) {
  const nodes=new Map(current.nodes.map(n=>[n.id,{id:n.id,name:n.name,owner:n.owner||'',
    incoming:[],outgoing:[],unfinishedIncoming:[]}]));
  const edges=current.edges.map(e=>{
    const from=nodes.get(e.from),to=nodes.get(e.to);
    if(!from||!to)throw Error('计划连线指向不存在的节点，请核对网站版本');
    from.outgoing.push(e.to);
    to.incoming.push(e.from);
    if(!e.completedAt)to.unfinishedIncoming.push(e.from);
    return {from:e.from,to:e.to,dashed:!!e.dashed,estimate:e.upper,executor:e.executor||'',
      completedAt:e.completedAt||''};
  });
  const rows=[...nodes.values()];
  return {nodes:rows,edges,starts:rows.filter(n=>!n.incoming.length).map(n=>n.id),
    ends:rows.filter(n=>!n.outgoing.length).map(n=>n.id),
    forks:rows.filter(n=>n.outgoing.length>1).map(n=>n.id),
    joins:rows.filter(n=>n.incoming.length>1).map(n=>n.id)};
}

export function planRelations(record,listed,projects,tasks,meta,session,workTasks=[]) {
  if(listed?.id!==record.id || listed.revision!==record.revision)
    throw Object.assign(Error('计划清单与详情版本不一致，请重新读取'),{code:'VERSION_CONFLICT'});
  const id=record.id;
  const linkedProjects=projects.filter(p=>p.planId===id);
  const linkedTasks=tasks.filter(t=>t.planId===id||t.projectPlanId===id);
  return {id,displayId:listed.displayId,revision:record.revision,number:record.current.planNumber,
    owner:record.current.planOwner,schedule:{start:record.current.start||null,
      configuredDeadline:record.current.deadline||null,forecast:listed.forecastDate||null},
    review:record.review?.status,groupId:listed.projectGroupId||null,
    assistantRoles:listed.assistantRoles||{},collaborators:record.collaborators||[],
    permissions:{...planAccess(session,record,listed),canAssociate:!session.mustChangePassword&&meta.canAssociate===true,
      canReviewRecords:!session.mustChangePassword&&meta.reviewer===true},
    projects:linkedProjects.map(p=>({id:p.id,number:p.number,businessNumber:p.referenceNumber,kind:p.kind,owner:p.owner,
      targetDate:p.targetDate,plannedDate:p.plannedDate,plannedDateSource:p.plannedDateSource,canModify:p.canModify})),
    tasks:linkedTasks.map(t=>({id:t.id,number:t.number,owner:t.owner,projectId:t.projectId,
      ownPlan:t.planId===id,projectPlan:t.projectPlanId===id,
      projectNodeId:t.projectNodeId||null,projectNodePlanId:t.projectPlanId||null,
      taskPlanDate:t.taskPlanDate,projectNodeDate:t.projectNodeDate,targetDate:t.targetDate,
      plannedDate:t.plannedDate,plannedDateSource:t.plannedDateSource,canModify:t.canModify})),
    workTasks:workTasks.filter(item=>item.planId===id).map(item=>({
      from:item.from,to:item.to,executor:item.executor,revision:item.revision,
      canAssign:!session.mustChangePassword && item.canAssign===true && item.revision===record.revision,
      canComplete:!session.mustChangePassword && item.canComplete===true && item.revision===record.revision,
      stale:item.revision!==record.revision})),
    graph:branchMap(record.current)};
}

export async function readRelations(request,record,session) {
  const [plans,projects,tasks,meta,workTasks]=await Promise.all(['/api/plans','/api/records/projects',
    '/api/records/tasks','/api/records/meta','/api/work-tasks'].map(path=>request(path)));
  const latestSession=await request('/api/session');
  if(latestSession.actor!==session.actor||latestSession.role!==session.role||latestSession.mustChangePassword!==session.mustChangePassword)
    throw Object.assign(Error('读取期间账号或权限发生变化'),{code:'HISTORY_CONTEXT_MISMATCH'});
  return planRelations(record,plans.find(p=>p.id===record.id),projects,tasks,meta,latestSession,workTasks);
}
