// These are the reference HTML's nine showcase registry keys (line 29568),
// not a one-to-one mapping to the article's nine source-file groups.
export const LAB_MODULES = [
  { id:'render', title:'光照与渲染', kicker:'LIGHT / PIPELINE', description:'在固定构图下观察曝光、阴影和后处理，区分光照变化与材质变化。', referenceKey:'render', sourceFiles:['src/render.js','src/env.js'], checks:['画面可渲染且着色器无错误','参数改变后输出与指标同步','暂停后时间相关效果保持稳定'], referenceEvidence:[{name:'原作入口',detail:'后处理链与渲染样板。原作保留独立 render showcase。',source:'reference-readable.js:17379–18409；showcase 18362'}] },
  { id:'mats', title:'材质样板', kicker:'SURFACE / PBR', description:'并排比较 18 种甲板、货箱涂装、金属与木材表面，检查粗糙度、法线和湿润响应。', referenceKey:'mats', sourceFiles:['src/surface-materials.js','src/textures.js','src/atmosphere.js'], checks:['材质样板使用真实网格与材质','湿润和粗糙度变化可观察','法线与高光无异常数值'], referenceEvidence:[{name:'原作生成路径',detail:'MRT 生成 albedo、ORM、height，再由高度生成法线；材质展示入口独立。',source:'reference-readable.js:19437–19525'},{name:'本展示场范围',detail:'使用地图共用工厂的 18 种场景表面，每种材质同时映射到球体与平板，可检查颜色、法线和粗糙度通道。',source:'src/lab/scenes/mats.js'}] },
  { id:'props', title:'道具工坊', kicker:'OBJECT / ASSEMBLY', description:'从单件几何到组合道具，检查比例、构造、批次与重复资源的使用。', referenceKey:'props', sourceFiles:['src/map.js','src/guns.js','src/gun-detail.js'], checks:['道具具有可绕视的真实几何','切换道具不会累积场景对象','几何与绘制统计随选择变化'], referenceEvidence:[{name:'原作道具注册表',detail:'以 registry factory 构造道具，并提供全道具排列的展示场。',source:'reference-readable.js:19796–21830；factory 19802；showcase 19816'}] },
  { id:'level', title:'关卡与路线', kicker:'SPACE / TRAVERSAL', description:'俯瞰运输船的通行层次、掩体和路线，在同一场景中核对视觉与空间结构。', referenceKey:'level', sourceFiles:['src/map.js','src/physics.js','src/objective.js'], checks:['场景可完整绕视','路线与高低差可定位','关卡对象数量保持有界'], referenceEvidence:[{name:'原作空间结构',detail:'堆场、仓库、码头三区，中继、屋顶台阶与掩体点；不是运输船地图本身。',source:'reference-readable.js:22456–22547'}] },
  { id:'backdrop', title:'港区远景', kicker:'DISTANCE / SILHOUETTE', description:'观察吊机、船体和天际线如何形成景深，验证远景轮廓与雾的配合。', referenceKey:'backdrop', sourceFiles:['src/map.js','src/env.js','src/atmosphere.js'], checks:['远景为可移动视角的三维场景','雾与背景参数可重复调整','相机切换不改变场景资源总量'], referenceEvidence:[{name:'原作远景组合',detail:'吊机、货轮、撤离艇与天际线构成港区背景，并有独立展示入口。',source:'reference-readable.js:23450–23495'}] },
  { id:'ground', title:'地面与雨水', kicker:'GROUND / WEATHER', description:'近距离观察湿润表面、雨线与落点，检查遮蔽、反射和雨水尺度。', referenceKey:'ground', sourceFiles:['src/weather.js','src/atmosphere.js','src/env.js','src/textures.js'], checks:['地面与雨滴响应真实参数','雨量与活动粒子数保持有界','暂停后雨与水面动画不推进'], referenceEvidence:[{name:'原作地面系统',detail:'湿度遮罩、平面反射、雨与水面集中在 ground；运输船按职责拆入多个模块。',source:'reference-readable.js:23496–24172；showcase 24164'}] },
  { id:'fx', title:'反馈与特效', kicker:'IMPACT / RESPONSE', description:'单独触发命中、弹壳与粒子，检查接触、寿命和材质响应。声音属于此处的子测试。', referenceKey:'fx', sourceFiles:['src/effects.js','src/impact-pools.js','src/audio.js','src/combat-feedback.js'], checks:['特效由实际操作触发','粒子结束后回收或复用','材质命中与反馈保持一致'], referenceEvidence:[{name:'原作特效系统',detail:'材质 impact、有界粒子池与弹壳。audio 不属于九入口；原作 show 分支使用静音 stub。',source:'reference-readable.js:24173–25338；showcase 25290；show boot 29632'}] },
  { id:'weapon', title:'武器与持枪', kicker:'VIEWMODEL / MOTION', description:'检查握持、瞄准、射击和分阶段换弹；玩家输入与准星作为武器的子测试。', referenceKey:'weapon', sourceFiles:['src/viewmodel.js','src/view-hands.js','src/gun-detail.js','src/guns.js','src/weapons.js'], checks:['枪与手保持可验证的接触关系','瞄具与视线一致','换弹、切枪与暂停恢复正确'], referenceEvidence:[{name:'原作武器范围',detail:'单把定制步枪，包含双手、换弹与瞄具；运输船保留多武器玩法。',source:'reference-readable.js:27037–27964；姿态展示 27940'}] },
  { id:'enemies', title:'角色与战术', kicker:'ACTOR / BEHAVIOR', description:'观察人物骨骼、动作、命中回摆与细节等级，分开检查外观和行为。', referenceKey:'enemies', sourceFiles:['src/character.js','src/actor.js','src/bots.js','src/tactics.js'], checks:['角色姿态与骨骼保持有效','细节切换不替换骨架','受击与行为测试有明确反馈'], referenceEvidence:[{name:'原作敌人范围',detail:'原作是机械鸥和四足猎犬，采用 LOS 感知与攻击令牌；运输船采用士兵。默认展示为被动巡逻，eshow=fight 才进入战斗变体。',source:'reference-readable.js:27965–28837；LOS 28596；showcase 28816'}] },
];

const implementationNotes={
  render:'复用正式游戏后期链；可分别切换末端抗锯齿、锐化、接触遮蔽、光雾分布、稳定辉光与阴影柔度。新增细栏杆斜边靶。渲染统计包含多通道工作量，不等同于单件模型成本。',
  mats:'共享脱漆、裸钢、锈蚀、流挂与木纹遮罩联动生成颜色、法线及 ORM。单独查看 G 粗糙度、B 金属度、R 遮蔽和 A 锈层；数据视图关闭后期，覆盖率随导出结果记录。',
  props:'复用正式地图预制件；立体梯形板、空心角件、圆锁杆与铰链按材质合批。可关闭立体箱体进行同视角对比；切换会重开场景并保留相机，碰撞边界保持一致。',
  level:'根据真实碰撞体与 NavGrid 生成双方可达路线。路线规划与实走验证分别记录，导航线本身不替代实际通行测试。',
  backdrop:'复用运输船、吊机、程序云层和海面；切换航速与光照时段，并读取实际航行距离和海面高度。',
  ground:'雨棚使用真实碰撞体写入遮雨高度图，与露天甲板同场对照；降雨、湿度和平面反射由正式天气系统响应。',
  fx:'直接调用正式命中、弹壳和声音系统，记录活动粒子与池容量；声音在用户点击操作后解锁，截图本身不证明音频效果。',
  weapon:'复用正式 ViewModel、持枪手骨骼与多武器模型；支持瞄准、检视、射击以及换弹进度检查。M4 机匣有真实抛壳口与凹腔，可观察枪机拉后的位置关系。',
  enemies:'分为角色与受击、机器人绕掩体与视线两类子测试。前者复用双阵营骨骼、远近细节和玩家生命反馈；后者检查真实机器人移动与感知，仍不等同于完整对局或战斗平衡验证。',
};
for(const module of LAB_MODULES){
  if(implementationNotes[module.id])module.referenceEvidence.push({name:'本展示场验证',detail:implementationNotes[module.id],source:`src/lab/scenes/${module.id}.js`});
}
findLabModule('enemies').title='角色与战术';
findLabModule('props').checks[1]='结构线切换不增加场景对象';
findLabModule('mats').sourceFiles.push('src/surface-fields.js','src/lab/material-inspector.js');
findLabModule('props').sourceFiles.push('src/props.js','src/prop-geometry.js');
findLabModule('render').sourceFiles.push('src/final-finish.js','src/stable-bloom.js');

export function findLabModule(id) { return LAB_MODULES.find(module=>module.id===id); }

// Automation exports must preserve actual controls, checks and errors, including
// pending checks. This describes the review loop; it does not fabricate a run.
export const LAB_ITERATION_CONTRACT = Object.freeze({
  version:1,
  moduleIds:Object.freeze(LAB_MODULES.map(module=>module.id)),
  stateFields:Object.freeze(['selected','controls','metrics','checks','cameraPresets','paused','time','errors','referenceEvidence']),
  steps:Object.freeze(['选择模块','重置场景','修改参数','运行并观察','检查与记录','导出结果']),
  checkStates:Object.freeze(['pass','fail','pending']),
});
