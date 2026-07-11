const fs = require('fs');
const path = require('path');

const SOURCE_DIR = 'G:\\Meu Drive\\LLM-Brain';
const DEST_DIR = 'C:\\Users\\olive\\llm-brain-mirror';
const FILES = ['active-context.md', 'task-queue.md', 'decisions.md', 'chatbot-builder-guide.md', 'hermes-integration-plan.md', 'xone-laudo-fotos-plan.md', 'ops-control-panel-prd.md', 'PLANO-HANDOFF-V3.md'];
const SYNC_INTERVAL_MS = 2000;

function safeStat(filePath) {
    try {
        return fs.statSync(filePath);
    } catch (e) {
        return null;
    }
}

function syncFiles() {
    for (const file of FILES) {
        const srcPath = path.join(SOURCE_DIR, file);
        const dstPath = path.join(DEST_DIR, file);

        const srcStat = safeStat(srcPath);
        const dstStat = safeStat(dstPath);

        if (srcStat && dstStat) {
            // Both exist, check mtime
            const srcMtime = srcStat.mtimeMs;
            const dstMtime = dstStat.mtimeMs;
            const diff = srcMtime - dstMtime;
            
            // Allow 1 second tolerance for precision differences
            if (diff > 1000) {
                // src is newer
                console.log(`[Sync] ${file} changed in GDrive. Syncing to mirror...`);
                fs.copyFileSync(srcPath, dstPath);
                // Update utimes to match exactly
                fs.utimesSync(dstPath, srcStat.atime, srcStat.mtime);
            } else if (diff < -1000) {
                // dest is newer
                console.log(`[Sync] ${file} changed in mirror. Syncing to GDrive...`);
                fs.copyFileSync(dstPath, srcPath);
                fs.utimesSync(srcPath, dstStat.atime, dstStat.mtime);
            }
        } else if (srcStat && !dstStat) {
            console.log(`[Sync] ${file} found in GDrive but not mirror. Copying...`);
            fs.copyFileSync(srcPath, dstPath);
            fs.utimesSync(dstPath, srcStat.atime, srcStat.mtime);
        } else if (dstStat && !srcStat) {
            console.log(`[Sync] ${file} found in mirror but not GDrive. Copying...`);
            fs.copyFileSync(dstPath, srcPath);
            fs.utimesSync(srcPath, dstStat.atime, dstStat.mtime);
        }
    }
}

console.log(`[LLM-Brain Sync] Starting sync between\n  - ${SOURCE_DIR}\n  - ${DEST_DIR}`);
console.log(`Interval: ${SYNC_INTERVAL_MS}ms`);

// Initial sync
syncFiles();

// Continuous sync
setInterval(syncFiles, SYNC_INTERVAL_MS);
