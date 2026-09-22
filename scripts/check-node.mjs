// A build on the wrong Node bakes a native module the app cannot load, and the free AI
// option dies at launch with nothing on screen. .nvmrc and both engines fields say 24.
const major = Number(process.versions.node.split(".")[0]);
if (major !== 24) throw new Error(`Node ${process.version} can't build Bees. Use Node 24 (.nvmrc).`);
