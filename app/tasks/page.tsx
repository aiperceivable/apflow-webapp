'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Task List/Detail Page
 * 
 * Display list of all tasks with filtering and search, or task detail if ?id=xxx is provided
 */

import { Container, Title, Button, Group, TextInput, Table, Badge, ActionIcon, Tooltip, Text, Select, Stack, useMantineColorScheme, Card, Code, Tabs, Progress } from '@mantine/core';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, Task } from '@/lib/api/apflow';
import { useTranslation } from 'react-i18next';
import { useRouter, useSearchParams } from 'next/navigation';
import { IconPlus, IconSearch, IconEye, IconCopy, IconTrash, IconDatabase, IconInfoCircle, IconPlayerPlay, IconChevronDown, IconChevronRight, IconArrowLeft, IconTree, IconCode, IconFileText, IconRefresh } from '@tabler/icons-react';
import { useState, useRef, useEffect, Fragment, Suspense } from 'react';
import { notifications } from '@mantine/notifications';
import { TaskTreeView } from '@/components/tasks/TaskTreeView';

function TaskListPageContent() {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { colorScheme } = useMantineColorScheme();
  const [searchQuery, setSearchQuery] = useState('');
  
  // Get task ID from query parameter
  const taskId = searchParams?.get('id') || '';

  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [viewMode, setViewMode] = useState<'root' | 'all'>('root');
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [childrenCache, setChildrenCache] = useState<Record<string, Task[]>>({});
  const [executingTaskId, setExecutingTaskId] = useState<string | null>(null);
  
  // Ref to store SSE cleanup functions (one per task)
  const sseCleanupRefs = useRef<Map<string, () => void>>(new Map());

  // List tasks - default to root only
  const { data: tasksResult, isLoading } = useQuery({
    queryKey: ['tasks', searchQuery, statusFilter, viewMode],
    queryFn: () => apiClient.listTasks({ 
      status: statusFilter,
    }),
  });

  const tasks = tasksResult?.tasks || [];

  const deleteMutation = useMutation({
    mutationFn: (taskId: string) => apiClient.deleteTask(taskId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      notifications.show({
        title: t('common.success'),
        message: t('tasks.delete') + ' ' + t('common.success'),
        color: 'green',
      });
    },
    onError: (error: any) => {
      notifications.show({
        title: t('common.error'),
        message: error.message || t('errors.apiError'),
        color: 'red',
      });
    },
  });

  const copyMutation = useMutation({
    mutationFn: (taskId: string) => apiClient.copyTask(taskId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      notifications.show({
        title: t('common.success'),
        message: t('tasks.copy') + ' ' + t('common.success'),
        color: 'green',
      });
    },
    onError: (error: any) => {
      notifications.show({
        title: t('common.error'),
        message: error.message || t('errors.apiError'),
        color: 'red',
      });
    },
  });

  const retryMutation = useMutation({
    mutationFn: (id: string) => apiClient.retryTask(id, crypto.randomUUID()),
    onSuccess: (retry) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['running-tasks'] });
      notifications.show({ title: t('common.success'), message: 'Retry submitted', color: 'green' });
      router.push(`/tasks?id=${encodeURIComponent(retry.root_task_id)}`);
    },
    onError: (error: Error) => notifications.show({ title: t('common.error'), message: error.message, color: 'red' }),
  });

  const executeMutation = useMutation({
    mutationFn: (taskId: string) => {
      // Set executing task ID when execution starts
      setExecutingTaskId(taskId);
      return apiClient.executeTask(
        taskId,
        true, // Enable streaming
        (event: any) => {
          // Handle SSE events in real-time
          queryClient.invalidateQueries({ queryKey: ['tasks'] });
          queryClient.invalidateQueries({ queryKey: ['running-tasks'] });

          // Show notification on completion or failure and clear executing state
          if (event.final || event.type === 'stream_end') {
            setExecutingTaskId(null);
            if (event.status === 'completed') {
              // 立即更新 tasks 列表缓存中对应任务的状态为 completed
              queryClient.setQueryData(['tasks', searchQuery, statusFilter, viewMode], (oldTasks: any) => {
                if (!oldTasks) return oldTasks;
                // 兼容数组和对象
                if (Array.isArray(oldTasks)) {
                  return oldTasks.map((t) => t.id === taskId ? { ...t, status: 'completed' } : t);
                }
                return oldTasks;
              });
              notifications.show({
                title: 'Task Completed',
                message: `Task ${taskId} completed successfully`,
                color: 'green',
              });
            } else if (event.status === 'failed') {
              notifications.show({
                title: 'Task Failed',
                message: event.error || `Task ${taskId} execution failed`,
                color: 'red',
              });
            }
          }
        }
      );
    },
    onSuccess: (data) => {
      notifications.show({
        title: t('common.success'),
        message: data.message || 'Task execution started',
        color: 'green',
      });
      
      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['running-tasks'] });
    },
    onError: (error: any) => {
      // Clear executing state on error
      setExecutingTaskId(null);
      notifications.show({
        title: t('common.error'),
        message: error.message || 'Failed to execute task',
        color: 'red',
      });
    },
  });

  // Cleanup all SSE connections on unmount
  useEffect(() => {
    const cleanupRefs = sseCleanupRefs.current;
    return () => {
      cleanupRefs.forEach((cleanup) => cleanup());
      cleanupRefs.clear();
    };
  }, []);

  // Fetch children for a parent task
  const fetchChildren = async (parentId: string) => {
    if (childrenCache[parentId]) {
      return childrenCache[parentId];
    }
    try {
      const result = await apiClient.getTaskChildren(parentId);
      const children = result.children || [];
      setChildrenCache(prev => ({ ...prev, [parentId]: children }));
      return children;
    } catch (error: any) {
      notifications.show({
        title: 'Error',
        message: error.message || 'Failed to load child tasks',
        color: 'red',
      });
      return [];
    }
  };

  const toggleExpand = async (taskId: string) => {
    const newExpanded = new Set(expandedTasks);
    if (newExpanded.has(taskId)) {
      newExpanded.delete(taskId);
    } else {
      newExpanded.add(taskId);
      // If children not loaded yet, fetch them
      if (!childrenCache[taskId]) {
        await fetchChildren(taskId);
      }
    }
    setExpandedTasks(newExpanded);
  };

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'completed':
        return 'green';
      case 'failed':
        return 'red';
      case 'in_progress':
        return 'blue';
      case 'cancelled':
        return 'gray';
      default:
        return 'yellow';
    }
  };

  const filteredTasks = tasks?.filter((task) =>
    task.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    task.id.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  // Helper function to check if a task should show loading/running state
  const isTaskExecuting = (task: Task, parentId?: string): boolean => {
    // Check if this task is the one being executed
    if (task.id === executingTaskId) {
      return true;
    }
    // Check if task status is in_progress
    if (task.status === 'in_progress') {
      return true;
    }
    // Check if parent is executing (for child tasks)
    // Check both the passed parentId and task.parent_id
    if (parentId && parentId === executingTaskId) {
      return true;
    }
    if (task.parent_id && task.parent_id === executingTaskId) {
      return true;
    }
    return false;
  };

  // Render task row recursively (supports nested children)
  const renderTaskRow = (task: Task, level: number = 0, parentId?: string) => {
    const isExpanded = expandedTasks.has(task.id);
    const children = childrenCache[task.id] || [];
    const isRoot = level === 0;
    // Check if task has children:
    // 1. Use has_children field if available (from backend)
    // 2. If we've already loaded children and there are some, it has children
    const hasChildren = task.has_children === true || children.length > 0;

    // Get background color based on theme and level
    const getBackgroundColor = () => {
      if (level === 0) return undefined;
      // Use theme-appropriate colors
      if (colorScheme === 'dark') {
        return 'var(--mantine-color-dark-7)';
      }
      return 'var(--mantine-color-gray-0)';
    };

    // Get text color based on theme and level
    const getTextColor = () => {
      if (level === 0) return undefined;
      if (colorScheme === 'dark') {
        return 'var(--mantine-color-dark-0)';
      }
      return 'var(--mantine-color-gray-9)';
    };

    return (
      <Fragment key={task.id}>
        <Table.Tr 
          style={{ 
            backgroundColor: getBackgroundColor(),
            color: getTextColor()
          }}
        >
          <Table.Td>
            <Group gap="xs">
              {isRoot && hasChildren && (
                <ActionIcon
                  variant="subtle"
                  size="sm"
                  onClick={() => toggleExpand(task.id)}
                  style={{ cursor: 'pointer' }}
                >
                  {isExpanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                </ActionIcon>
              )}
              {isRoot && !hasChildren && (
                <div style={{ width: 20 }} /> // Spacer to align with tasks that have children
              )}
              {!isRoot && (
                <Text size="sm" c="dimmed" style={{ marginLeft: `${(level - 1) * 20}px` }}>
                  └─
                </Text>
              )}
              <Text size="sm" ff="monospace" c={colorScheme === 'dark' ? 'dark.0' : 'gray.9'}>
                {`${task.id.substring(0, 4)}...${task.id.substring(task.id.length - 4)}`}
              </Text>
            </Group>
          </Table.Td>
          <Table.Td>
            <Text 
              fw={level > 0 ? 500 : undefined}
              style={{ marginLeft: !isRoot ? `${level * 20}px` : 0 }} 
              c={colorScheme === 'dark' ? 'dark.0' : 'gray.9'}
            >
              {task.name}
            </Text>
          </Table.Td>
          <Table.Td>
            <Badge color={getStatusColor(task.status)}>
              {task.status || 'pending'}
            </Badge>
          </Table.Td>
          <Table.Td>
            <Text c={colorScheme === 'dark' ? 'dark.0' : 'gray.9'}>
              {Math.round((task.progress || 0) * 100)}%
            </Text>
          </Table.Td>
          <Table.Td>
            <Group gap="xs">
              <Tooltip label={t('tasks.view')}>
                <ActionIcon
                  variant="subtle"
                  onClick={() => router.push(`/tasks?id=${task.id}`)}
                >
                  <IconEye size={16} />
                </ActionIcon>
              </Tooltip>
              {!task.parent_id && level === 0 && (task.status === 'pending' || task.status === 'failed') && (
                <Tooltip label={task.status === 'failed' ? 'Retry Task' : 'Execute Task'}>
                  <ActionIcon
                    variant="subtle"
                    color={task.status === 'failed' ? 'orange' : 'blue'}
                    onClick={() => task.status === 'failed' ? retryMutation.mutate(task.id) : executeMutation.mutate(task.id)}
                    loading={isTaskExecuting(task, parentId) || retryMutation.isPending}
                  >
                    {task.status === 'failed' ? <IconRefresh size={16} /> : <IconPlayerPlay size={16} />}
                  </ActionIcon>
                </Tooltip>
              )}
              <Tooltip label={t('tasks.copy')}>
                <ActionIcon
                  variant="subtle"
                  onClick={() => copyMutation.mutate(task.id)}
                  loading={copyMutation.isPending}
                >
                  <IconCopy size={16} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label={t('tasks.delete')}>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  onClick={() => deleteMutation.mutate(task.id)}
                  loading={deleteMutation.isPending}
                >
                  <IconTrash size={16} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Table.Td>
        </Table.Tr>
        {isExpanded && children.map((child) => renderTaskRow(child, level + 1, task.id))}
      </Fragment>
    );
  };

  // Task detail queries (only when taskId is provided)
  const { data: task, isLoading: isLoadingTask } = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => {
      if (!taskId) {
        throw new Error('Task ID is required');
      }
      return apiClient.getTask(taskId);
    },
    enabled: !!taskId,
  });

  const { data: taskTree } = useQuery({
    queryKey: ['task-tree', taskId],
    queryFn: () => apiClient.getTaskTree(taskId),
    enabled: !!task && !!taskId,
  });

  // Task detail execute mutation
  const executeDetailMutation = useMutation({
    mutationFn: (taskId: string) => {
      return apiClient.executeTask(
        taskId,
        true, // Enable streaming
        (event: any) => {
          // Handle SSE events in real-time
          queryClient.setQueryData(['task', taskId], (oldData: Task | undefined) => {
            if (!oldData) return oldData;
            return {
              ...oldData,
              status: event.status || oldData.status,
              progress: event.progress !== undefined ? event.progress : oldData.progress,
              result: event.result !== undefined ? event.result : oldData.result,
              error: event.error || oldData.error,
            };
          });

          // Invalidate queries to refresh tree view
          queryClient.invalidateQueries({ queryKey: ['task-tree', taskId] });
          queryClient.invalidateQueries({ queryKey: ['tasks'] });
          queryClient.invalidateQueries({ queryKey: ['running-tasks'] });

          // Show notification on completion or failure
          if (event.final || event.type === 'stream_end') {
            if (event.status === 'completed') {
              notifications.show({
                title: 'Task Completed',
                message: 'Task execution completed successfully',
                color: 'green',
              });
            } else if (event.status === 'failed') {
              notifications.show({
                title: 'Task Failed',
                message: event.error || 'Task execution failed',
                color: 'red',
              });
            }
          }
        }
      );
    },
    onSuccess: (data) => {
      notifications.show({
        title: 'Success',
        message: data.message || 'Task execution started',
        color: 'green',
      });
      
      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ['task', taskId] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['running-tasks'] });
    },
    onError: (error: any) => {
      notifications.show({
        title: 'Error',
        message: error.message || 'Failed to execute task',
        color: 'red',
      });
    },
  });

  // If taskId is provided, show task detail view
  if (taskId) {
    if (isLoadingTask) {
      return (
        <Container size="xl">
          <Text c="dimmed">{t('common.loading')}</Text>
        </Container>
      );
    }

    if (!task) {
      return (
        <Container size="xl">
          <Text c="red">{t('errors.taskNotFound')}</Text>
          <Button mt="md" onClick={() => router.push('/tasks')}>
            {t('common.back')}
          </Button>
        </Container>
      );
    }

    return (
      <Container size="xl">
        <Group mb="xl" justify="space-between">
          <Button
            variant="subtle"
            leftSection={<IconArrowLeft size={16} />}
            onClick={() => router.push('/tasks')}
          >
            {t('common.back')}
          </Button>
          {!task.parent_id && (task.status === 'pending' || task.status === 'failed') && (
            <Button
              leftSection={task.status === 'failed' ? <IconRefresh size={16} /> : <IconPlayerPlay size={16} />}
              onClick={() => task.status === 'failed' ? retryMutation.mutate(taskId) : executeDetailMutation.mutate(taskId)}
              loading={executeDetailMutation.isPending || retryMutation.isPending}
              color={task.status === 'failed' ? 'orange' : 'blue'}
            >
              {task.status === 'failed' ? 'Retry Task' : 'Execute Task'}
            </Button>
          )}
        </Group>

        <Title order={1} mb="xl">{task.name}</Title>

        <Tabs defaultValue="overview">
          <Tabs.List style={{ color: colorScheme === 'dark' ? undefined : 'var(--mantine-color-gray-9)' }}>
            <Tabs.Tab value="overview" leftSection={<IconInfoCircle size={16} />}>
              {t('tasks.detail')}
            </Tabs.Tab>
            <Tabs.Tab value="tree" leftSection={<IconTree size={16} />}>
              Tree View
            </Tabs.Tab>
            <Tabs.Tab value="inputs" leftSection={<IconCode size={16} />}>
              {t('taskForm.inputs')}
            </Tabs.Tab>
            <Tabs.Tab value="result" leftSection={<IconFileText size={16} />}>
              Result
            </Tabs.Tab>
            <Tabs.Tab value="json" leftSection={<IconDatabase size={16} />}>
              Full Model (JSON)
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="overview" pt="md">
            <Stack gap="md">
              <Card shadow="sm" padding="lg" radius="md" withBorder>
                <Group justify="space-between" mb="md">
                  <Text fw={500}>{t('tasks.status')}</Text>
                  <Badge color={getStatusColor(task.status)} size="lg">
                    {task.status || 'pending'}
                  </Badge>
                </Group>
                {task.progress !== undefined && (
                  <>
                    <Text fw={500} mb="xs">{t('tasks.progress')}</Text>
                    <Progress value={(task.progress || 0) * 100} mb="md" />
                  </>
                )}
                <Group justify="space-between">
                  <div>
                    <Text size="sm" c={colorScheme === 'dark' ? 'dimmed' : 'gray.7'}>{t('tasks.id')}</Text>
                    <Code>{task.id}</Code>
                  </div>
                  {task.parent_id && (
                    <div>
                      <Text size="sm" c={colorScheme === 'dark' ? 'dimmed' : 'gray.7'}>Parent ID</Text>
                      <Code>{task.parent_id}</Code>
                    </div>
                  )}
                </Group>
                {task.created_at && (
                  <Group justify="space-between" mt="md">
                    <div>
                      <Text size="sm" c={colorScheme === 'dark' ? 'dimmed' : 'gray.7'}>{t('tasks.createdAt')}</Text>
                      <Text size="sm">{new Date(task.created_at).toLocaleString()}</Text>
                    </div>
                    {task.updated_at && (
                      <div>
                        <Text size="sm" c={colorScheme === 'dark' ? 'dimmed' : 'gray.7'}>{t('tasks.updatedAt')}</Text>
                        <Text size="sm">{new Date(task.updated_at).toLocaleString()}</Text>
                      </div>
                    )}
                  </Group>
                )}
              </Card>

              {task.error && (
                <Card shadow="sm" padding="lg" radius="md" withBorder style={{ borderColor: 'var(--mantine-color-red-6)' }}>
                  <Text fw={500} c="red" mb="xs">Error</Text>
                  <Code block>{task.error}</Code>
                </Card>
              )}
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="tree" pt="md">
            {taskTree ? (
              <TaskTreeView task={taskTree} />
            ) : (
              <Text c="dimmed">No tree data available</Text>
            )}
          </Tabs.Panel>

          <Tabs.Panel value="inputs" pt="md">
            <Card shadow="sm" padding="lg" radius="md" withBorder>
              <Code block>{JSON.stringify(task.inputs || {}, null, 2)}</Code>
            </Card>
          </Tabs.Panel>

          <Tabs.Panel value="result" pt="md">
            <Stack gap="md">
              {taskTree && (
                <>
                  <div>
                    <Group justify="space-between" mb="xs">
                      <Text fw={500} size="sm">Task Tree Results</Text>
                      <Tooltip label="Copy to clipboard">
                        <ActionIcon
                          variant="subtle"
                          onClick={() => {
                            navigator.clipboard.writeText(JSON.stringify(taskTree, null, 2));
                            notifications.show({
                              title: 'Copied',
                              message: 'Task tree results copied to clipboard',
                              color: 'green',
                            });
                          }}
                        >
                          <IconCopy size={16} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                    <Card shadow="sm" padding="lg" radius="md" withBorder>
                      <Code block style={{ maxHeight: '70vh', overflow: 'auto' }}>
                        {JSON.stringify(taskTree, null, 2)}
                      </Code>
                    </Card>
                  </div>
                </>
              )}
              {task.result && (
                <div>
                  <Group justify="space-between" mb="xs">
                    <Text fw={500} size="sm">Current Task Result</Text>
                    <Tooltip label="Copy to clipboard">
                      <ActionIcon
                        variant="subtle"
                        onClick={() => {
                          navigator.clipboard.writeText(JSON.stringify(task.result, null, 2));
                          notifications.show({
                            title: 'Copied',
                            message: 'Task result copied to clipboard',
                            color: 'green',
                          });
                        }}
                      >
                        <IconCopy size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                  <Card shadow="sm" padding="lg" radius="md" withBorder>
                    <Code block style={{ maxHeight: '40vh', overflow: 'auto' }}>
                      {JSON.stringify(task.result, null, 2)}
                    </Code>
                  </Card>
                </div>
              )}
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="json" pt="md">
            <Card shadow="sm" padding="lg" radius="md" withBorder>
              <Group justify="space-between" mb="md">
                <Text size="sm" c={colorScheme === 'dark' ? 'dimmed' : 'gray.7'}>
                  Complete task tree with all nested children and their data
                </Text>
                <Tooltip label="Copy to clipboard">
                  <ActionIcon
                    variant="subtle"
                    onClick={() => {
                      navigator.clipboard.writeText(JSON.stringify(taskTree || task, null, 2));
                      notifications.show({
                        title: 'Copied',
                        message: 'Full JSON copied to clipboard',
                        color: 'green',
                      });
                    }}
                  >
                    <IconCopy size={16} />
                  </ActionIcon>
                </Tooltip>
              </Group>
              <Code block style={{ maxHeight: '70vh', overflow: 'auto' }}>
                {JSON.stringify(taskTree || task, null, 2)}
              </Code>
            </Card>
          </Tabs.Panel>
        </Tabs>
      </Container>
    );
  }

  // Otherwise, show task list view
  return (
    <Container size="xl">
      <Group justify="space-between" mb="xl">
        <Title order={1}>{t('tasks.list')}</Title>
        <Button
          leftSection={<IconPlus size={16} />}
          onClick={() => router.push('/tasks/create')}
        >
          {t('nav.createTask')}
        </Button>
      </Group>

      <Group mb="md">
        <TextInput
          placeholder={t('common.search')}
          leftSection={<IconSearch size={16} />}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ flex: 1 }}
        />
        <Select
          placeholder="View Mode"
          value={viewMode}
          onChange={(value) => {
            setViewMode(value as 'root' | 'all');
            setExpandedTasks(new Set()); // Clear expanded state when switching view
            setChildrenCache({}); // Clear cache
          }}
          data={[
            { value: 'root', label: 'Root Tasks Only' },
            { value: 'all', label: 'All Tasks' },
          ]}
          style={{ width: 180 }}
        />
        <Select
          placeholder={t('tasks.filterByStatus') || 'Filter by status'}
          value={statusFilter || null}
          onChange={(value) => setStatusFilter(value || undefined)}
          data={[
            { value: '', label: t('tasks.allStatuses') || 'All Statuses' },
            { value: 'pending', label: 'Pending' },
            { value: 'in_progress', label: 'In Progress' },
            { value: 'completed', label: 'Completed' },
            { value: 'failed', label: 'Failed' },
            { value: 'cancelled', label: 'Cancelled' },
          ]}
          clearable
          style={{ width: 200 }}
        />
      </Group>

      {isLoading ? (
        <Text c="dimmed">{t('common.loading')}</Text>
      ) : filteredTasks.length === 0 ? (
        <Stack gap="md" align="center" py="xl">
          <Text c="dimmed" size="lg">{t('tasks.noTasks')}</Text>
        </Stack>
      ) : (
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr style={{ color: colorScheme === 'dark' ? undefined : 'var(--mantine-color-gray-9)' }}>
              <Table.Th>{t('tasks.id')}</Table.Th>
              <Table.Th>{t('tasks.name')}</Table.Th>
              <Table.Th>{t('tasks.status')}</Table.Th>
              <Table.Th>{t('tasks.progress')}</Table.Th>
              <Table.Th>{t('tasks.actions')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {filteredTasks.map((task) => renderTaskRow(task))}
          </Table.Tbody>
        </Table>
      )}
    </Container>
  );
}

export default function TaskListPage() {
  return (
    <Suspense fallback={
      <Container size="xl">
        <Text c="dimmed">Loading...</Text>
      </Container>
    }>
      <TaskListPageContent />
    </Suspense>
  );
}
