// A build on the wrong Node bakes a native module the app cannot load, and the free AI
// option dies at launch with nothing on screen. .nvmrc and both engines fields say 24.
// 24.0 to 24.6 fail any sql with ?1 style params ("column index out of range"), so startup hangs.
const [major, minor] = process.versions.node.split(".").map(Number);
if (major !== 24 || minor < 7) throw new Error(`Node ${process.version} can't build Bees. Use Node 24.7 or newer 24.x (.nvmrc).`);
