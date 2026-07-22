const fs = require('fs');
const files = ['icons.jsx', 'widgets.jsx', 'flow.jsx', 'panels.jsx', 'tweaks-panel.jsx', 'main.jsx'];
for (const f of files) {
  const p = 'src/components/' + f;
  let text = fs.readFileSync(p, 'utf8');
  text = text.replace(/^\(function \(\) \{\r?\n/, '');
  text = text.replace(/\}\)\(\);\s*$/, '');
  
  if (f === 'icons.jsx') {
    text = `import React from 'react';\n` + text;
    text = text.replace('window.GDriveGlyph = GDriveGlyph;', 'export { GDriveGlyph };');
    text = text.replace('window.Icon = Icon;', 'export { Icon };');
    text = text.replace('window.HDLib = { ago, shortId, statusMeta, agentOf, cls };', 'export const HDLib = { ago, shortId, statusMeta, agentOf, cls };');
  }
  if (f === 'widgets.jsx') {
    text = `import React from 'react';\nimport { Icon, HDLib } from './icons.jsx';\n` + text;
    text = text.replace('const Icon = window.Icon;\r\n', '');
    text = text.replace('const Icon = window.Icon;\n', '');
    text = text.replace('const { ago, shortId, statusMeta, agentOf, cls } = window.HDLib;\r\n', 'const { ago, shortId, statusMeta, agentOf, cls } = HDLib;\r\n');
    text = text.replace('const { ago, shortId, statusMeta, agentOf, cls } = window.HDLib;\n', 'const { ago, shortId, statusMeta, agentOf, cls } = HDLib;\n');
    text = text.replace('window.HDW = { Section, StatusPill, AgentTag, DataTable, TimelineChart, DistBars, Sparkline, KpiStrip, Inspector };', 'export const HDW = { Section, StatusPill, AgentTag, DataTable, TimelineChart, DistBars, Sparkline, KpiStrip, Inspector };');
  }
  if (f === 'flow.jsx') {
    text = `import React from 'react';\nimport { Icon, HDLib } from './icons.jsx';\n` + text;
    text = text.replace('const Icon = window.Icon;\r\n', '');
    text = text.replace('const Icon = window.Icon;\n', '');
    text = text.replace('const { cls, agentOf } = window.HDLib;\r\n', 'const { cls, agentOf } = HDLib;\r\n');
    text = text.replace('const { cls, agentOf } = window.HDLib;\n', 'const { cls, agentOf } = HDLib;\n');
    text = text.replace('window.HDFlow = { LiveHandoffFlow };', 'export const HDFlow = { LiveHandoffFlow };');
  }
  if (f === 'panels.jsx') {
    text = `import React from 'react';\nimport { Icon, HDLib } from './icons.jsx';\nimport { HDW } from './widgets.jsx';\nimport { HDFlow } from './flow.jsx';\n` + text;
    text = text.replace('const Icon = window.Icon;\r\n', '');
    text = text.replace('const Icon = window.Icon;\n', '');
    text = text.replace('const { ago, shortId, statusMeta, cls } = window.HDLib;\r\n', 'const { ago, shortId, statusMeta, cls } = HDLib;\r\n');
    text = text.replace('const { ago, shortId, statusMeta, cls } = window.HDLib;\n', 'const { ago, shortId, statusMeta, cls } = HDLib;\n');
    text = text.replace('const { Section, StatusPill, AgentTag, DataTable, DistBars, Sparkline, KpiStrip } = window.HDW;\r\n', 'const { Section, StatusPill, AgentTag, DataTable, DistBars, Sparkline, KpiStrip } = HDW;\r\n');
    text = text.replace('const { Section, StatusPill, AgentTag, DataTable, DistBars, Sparkline, KpiStrip } = window.HDW;\n', 'const { Section, StatusPill, AgentTag, DataTable, DistBars, Sparkline, KpiStrip } = HDW;\n');
    text = text.replace('const { LiveHandoffFlow } = window.HDFlow;\r\n', 'const { LiveHandoffFlow } = HDFlow;\r\n');
    text = text.replace('const { LiveHandoffFlow } = window.HDFlow;\n', 'const { LiveHandoffFlow } = HDFlow;\n');
    text = text.replace('window.HDP = { OverviewPanel, HandoffsPanel, BrainPanel, InfraPanel, DataLakePanel };', 'export const HDP = { OverviewPanel, HandoffsPanel, BrainPanel, InfraPanel, DataLakePanel };');
  }
  if (f === 'tweaks-panel.jsx') {
    text = `import React from 'react';\nimport { Icon, HDLib } from './icons.jsx';\n` + text;
    text = text.replace('const Icon = window.Icon;\r\n', '');
    text = text.replace('const Icon = window.Icon;\n', '');
    text = text.replace('const { cls } = window.HDLib;\r\n', 'const { cls } = HDLib;\r\n');
    text = text.replace('const { cls } = window.HDLib;\n', 'const { cls } = HDLib;\n');
    text = text.replace('window.useTweaks = useTweaks;', 'export { useTweaks };');
    text = text.replace('window.TweaksPanel = TweaksPanel;', 'export { TweaksPanel };');
    text = text.replace('window.TweakSection = TweakSection;', 'export { TweakSection };');
    text = text.replace('window.TweakRadio = TweakRadio;', 'export { TweakRadio };');
    text = text.replace('window.TweakToggle = TweakToggle;', 'export { TweakToggle };');
    text = text.replace('window.TweakColor = TweakColor;', 'export { TweakColor };');
  }
  if (f === 'main.jsx') {
    text = `import React from 'react';\nimport ReactDOM from 'react-dom/client';\nimport { Icon, HDLib } from './icons.jsx';\nimport { HDP } from './panels.jsx';\nimport { HDW } from './widgets.jsx';\nimport { useTweaks, TweaksPanel, TweakSection, TweakRadio, TweakToggle, TweakColor } from './tweaks-panel.jsx';\n` + text;
    text = text.replace('const Icon = window.Icon;\r\n', '');
    text = text.replace('const Icon = window.Icon;\n', '');
    text = text.replace('const { cls } = window.HDLib;\r\n', 'const { cls } = HDLib;\r\n');
    text = text.replace('const { cls } = window.HDLib;\n', 'const { cls } = HDLib;\n');
    text = text.replace('const { OverviewPanel, HandoffsPanel, BrainPanel, InfraPanel, DataLakePanel } = window.HDP;\r\n', 'const { OverviewPanel, HandoffsPanel, BrainPanel, InfraPanel, DataLakePanel } = HDP;\r\n');
    text = text.replace('const { OverviewPanel, HandoffsPanel, BrainPanel, InfraPanel, DataLakePanel } = window.HDP;\n', 'const { OverviewPanel, HandoffsPanel, BrainPanel, InfraPanel, DataLakePanel } = HDP;\n');
    text = text.replace('const { Inspector } = window.HDW;\r\n', 'const { Inspector } = HDW;\r\n');
    text = text.replace('const { Inspector } = window.HDW;\n', 'const { Inspector } = HDW;\n');
    text = text.replace('const { useTweaks, TweaksPanel, TweakSection, TweakRadio, TweakToggle, TweakColor } = window;\r\n', '');
    text = text.replace('const { useTweaks, TweaksPanel, TweakSection, TweakRadio, TweakToggle, TweakColor } = window;\n', '');
    
    // We also need to export App instead of rendering it directly
    text = text.replace('ReactDOM.createRoot(document.getElementById(\'app-root\')).render(React.createElement(App));', 'export default App;');
  }
  
  fs.writeFileSync(p, text);
  console.log('Refactored ' + f);
}
