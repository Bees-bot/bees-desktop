export const DEFAULT_WORKFLOW = [{ name: 'Work', kind: 'work' }, { name: 'Review', kind: 'review' }];

export const processName = (workflow = DEFAULT_WORKFLOW) => workflow.length === DEFAULT_WORKFLOW.length
  && workflow.every((stage, index) => stage.name === DEFAULT_WORKFLOW[index].name && stage.kind === DEFAULT_WORKFLOW[index].kind)
  ? 'Goals' : 'Custom process';
