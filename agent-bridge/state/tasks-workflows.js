function createTasksWorkflowsState(options = {}) {
  const { io, tasksFile, workflowsFile, getTasksFile, getWorkflowsFile } = options;

  function resolveBranchName(branchName = 'main') {
    return typeof branchName === 'string' && branchName ? branchName : 'main';
  }

  function resolveTasksFile(branchName = 'main') {
    const branch = resolveBranchName(branchName);
    if (typeof getTasksFile === 'function') return getTasksFile(branch);
    return tasksFile;
  }

  function resolveWorkflowsFile(branchName = 'main') {
    const branch = resolveBranchName(branchName);
    if (typeof getWorkflowsFile === 'function') return getWorkflowsFile(branch);
    return workflowsFile;
  }

  function getCacheKey(prefix, branchName = 'main') {
    return `${prefix}:${resolveBranchName(branchName)}`;
  }

  function readTasks(branchName = 'main') {
    const filePath = resolveTasksFile(branchName);
    const tasks = io.readJsonFile(filePath, []);
    return Array.isArray(tasks) ? tasks : [];
  }

  function readWorkflows(branchName = 'main') {
    const filePath = resolveWorkflowsFile(branchName);
    const workflows = io.readJsonFile(filePath, []);
    return Array.isArray(workflows) ? workflows : [];
  }

  function saveTasks(tasks, writeOptions = {}) {
    const branch = resolveBranchName(writeOptions.branch);
    const filePath = resolveTasksFile(branch);
    return io.withLock(filePath, () => io.writeJson(filePath, tasks, {
      cacheKey: getCacheKey('tasks', branch),
      space: writeOptions.space,
    }));
  }

  function saveWorkflows(workflows, writeOptions = {}) {
    const branch = resolveBranchName(writeOptions.branch);
    const filePath = resolveWorkflowsFile(branch);
    return io.withLock(filePath, () => io.writeJson(filePath, workflows, {
      cacheKey: getCacheKey('workflows', branch),
      space: writeOptions.space,
    }));
  }

  function mutateTasks(mutator, writeOptions = {}) {
    const branch = resolveBranchName(writeOptions.branch);
    const filePath = resolveTasksFile(branch);
    return io.withLock(filePath, () => {
      const tasks = io.readJsonFile(filePath, []) || [];
      const result = mutator(tasks);
      io.writeJson(filePath, tasks, {
        cacheKey: getCacheKey('tasks', branch),
        space: writeOptions.space,
      });
      return result;
    });
  }

  function mutateWorkflows(mutator, writeOptions = {}) {
    const branch = resolveBranchName(writeOptions.branch);
    const filePath = resolveWorkflowsFile(branch);
    return io.withLock(filePath, () => {
      const workflows = io.readJsonFile(filePath, []) || [];
      const result = mutator(workflows);
      io.writeJson(filePath, workflows, {
        cacheKey: getCacheKey('workflows', branch),
        space: writeOptions.space,
      });
      return result;
    });
  }

  return {
    readTasks,
    readWorkflows,
    saveTasks,
    saveWorkflows,
    mutateTasks,
    mutateWorkflows,
  };
}

module.exports = { createTasksWorkflowsState };
