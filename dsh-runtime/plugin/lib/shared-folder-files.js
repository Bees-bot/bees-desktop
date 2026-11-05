export const SHARED_FOLDER_MARKER = '.bees-shared.json';
export const sharedControlFile = name => typeof name === 'string' && (name.toLowerCase() === SHARED_FOLDER_MARKER || /^\.bees-(probe|ack)-/i.test(name));
