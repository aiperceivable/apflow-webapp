/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import axios, { AxiosInstance } from 'axios';

const DEFAULT_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

const APFLOW_V2_MODULES = new Set([
  'task.create',
  'task.create_tree',
  'task.execute',
  'task.submit',
  'run.retry',
  'task.cancel',
  'task.get',
  'task.update',
  'task.list',
  'task.delete',
  'task.tree',
  'task.children',
  'task.link',
  'task.copy',
  'task.archive',
  'task.clone_mixed',
  'task.running',
  'task.scheduled',
  'schedule.set',
  'schedule.due',
  'schedule.trigger',
  'schedule.complete',
  'schedule.history',
  'schedule.export_ical',
]);

export interface Task {
  id: string;
  run_id?: string | null;
  name: string;
  user_id?: string;
  parent_id?: string;
  priority?: number;
  dependencies?: Array<{ id: string; required: boolean }>;
  inputs?: Record<string, any>;
  schemas?: Record<string, any>;
  params?: Record<string, any>;
  status?: string;
  progress?: number;
  result?: any;
  error?: string;
  created_at?: string;
  updated_at?: string;
  started_at?: string;
  completed_at?: string;
  children?: Task[];
  original_task_id?: string;
  has_copy?: boolean;
  has_children?: boolean;
  schedule_type?: string;
  schedule_expression?: string;
  schedule_enabled?: boolean;
  schedule_start_at?: string;
  schedule_end_at?: string;
  next_run_at?: string;
  last_run_at?: string;
  max_runs?: number;
  run_count?: number;
  token_budget?: number;
  cost_policy?: string;
  max_attempts?: number;
}

export interface ScheduledTask extends Task {
  schedule_type: string;
  schedule_expression: string;
  schedule_enabled: boolean;
}

export interface WebhookTriggerResponse {
  success: boolean;
  task_id: string;
  execution_id?: string;
  message?: string;
}

export interface TaskTree extends Task {
  children: Task[];
}

export interface CreateTaskResponse {
  id: string;
  name: string;
  status: string;
  created_at?: string;
}

export interface CreateTaskTreeResponse {
  root_task_id: string;
  task_count: number;
  task_ids: string[];
}

export interface GenerateTaskResponse {
  tasks: Task[];
  count: number;
  message: string;
  quota_info?: {
    total_used?: number;
    total_limit?: number | null;
    llm_used?: number;
    llm_limit?: number | null;
  };
}

export interface RunningTask {
  id: string;
  name: string;
  status: string;
  progress: number;
}

export interface RunningTaskStatus {
  task_id: string;
  status: string;
  message?: string;
}

export interface SystemHealth {
  status: string;
  version: string;
  uptime: number;
}

export interface TaskExecutionResponse {
  success: boolean;
  root_task_id: string;
  task_id: string;
  status: string;
  message: string;
  streaming?: boolean;
  events_url?: string;
}

export interface TaskEvent {
  type: string;
  task_id?: string;
  status?: string;
  progress?: number;
  result?: any;
  error?: string;
  final?: boolean;
  [key: string]: any;
}

export class AIPartnerUpFlowClient {
  private client: AxiosInstance;
  private baseURL: string;
  private withCredentials: boolean;

  constructor(baseURL: string = DEFAULT_API_URL) {
    this.baseURL = baseURL;
    this.withCredentials = Boolean(process.env.NEXT_PUBLIC_AUTO_LOGIN_PATH?.trim());
    this.client = axios.create({
      baseURL,
      headers: {
        'Content-Type': 'application/json',
      },
      withCredentials: this.withCredentials,
      timeout: 30000,
    });

    this.client.interceptors.request.use((config) => {
      const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }

      if (typeof window !== 'undefined' && !config.headers['X-LLM-API-KEY']) {
        const llmKey = localStorage.getItem('llm_api_key');
        if (llmKey) {
          config.headers['X-LLM-API-KEY'] = llmKey;
        }
      }

      return config;
    });

    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        const errorCode = error?.code || error?.errno || '';
        const errorMessage = error?.message || String(error) || 'Unknown error';
        const requestUrl = error?.config?.url || 'unknown';
        const fullUrl = error?.config?.baseURL
          ? `${error.config.baseURL}${requestUrl}`
          : `${this.baseURL}${requestUrl}`;

        if (errorCode === 'ECONNABORTED' || errorMessage.includes('timeout')) {
          console.group('⏱️ API Request Timeout');
          console.error('URL:', fullUrl);
          console.error('Base URL:', this.baseURL);
          console.error('Error Code:', errorCode);
          console.error('Error Message:', errorMessage);
          console.groupEnd();
        } else if (errorCode === 'ERR_NETWORK' || errorMessage === 'Network Error') {
          console.group('🌐 API Network Error');
          console.error('Full URL:', fullUrl);
          console.error('Base URL:', this.baseURL);
          console.error('Endpoint:', requestUrl);
          console.error('Error Code:', errorCode);
          console.error('Error Message:', errorMessage);
          console.groupEnd();
        } else if (error?.response) {
          const status = error.response.status;
          const method = error?.config?.method?.toUpperCase() || 'UNKNOWN';

          if (status === 401 && method !== 'OPTIONS') {
            console.error('--- Authentication Error ---');
            const hasToken = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
            console.error('Token in localStorage:', hasToken ? 'Present' : 'Missing');
          }
        }

        return Promise.reject(error);
      }
    );
  }

  private resolveModuleCandidates(moduleId: string): string[] {
    if (moduleId.startsWith('apflow.')) {
      const bareId = moduleId.slice('apflow.'.length);
      if (APFLOW_V2_MODULES.has(bareId)) {
        return [moduleId, bareId];
      }
    }

    if (APFLOW_V2_MODULES.has(moduleId)) {
      return [`apflow.${moduleId}`, moduleId];
    }

    return [moduleId];
  }

  private isModuleNotFound(error: any): boolean {
    const status = error?.response?.status;
    const errorCode = error?.response?.data?.error?.code;
    return status === 404 && (errorCode === 'MODULE_NOT_FOUND' || errorCode === 'NOT_FOUND' || !errorCode);
  }

  private toApiError(error: any): Error {
    if (error.response?.data?.error) {
      const errorData = error.response.data.error;
      const errorMessage = errorData.message || errorData.data || 'API Error';
      const apiError = new Error(String(errorMessage));
      (apiError as any).code = errorData.code;
      return apiError;
    }

    if (error.response?.data?.message || error.response?.data?.error) {
      return new Error(String(error.response.data.message || error.response.data.error));
    }

    return error;
  }

  private async moduleRequest<T>(moduleId: string, inputs?: any, config?: { headers?: Record<string, string> }): Promise<T> {
    const candidates = this.resolveModuleCandidates(moduleId);
    let lastError: any;

    for (const candidate of candidates) {
      try {
        const response = await this.client.post<T>(`/modules/${candidate}`, inputs || {}, config);
        return response.data;
      } catch (error: any) {
        lastError = error;
        if (!this.isModuleNotFound(error)) {
          throw this.toApiError(error);
        }
      }
    }

    throw this.toApiError(lastError);
  }

  private normalizeTaskTree(node: any): Task {
    if (node?.task) {
      return {
        ...node.task,
        children: (node.children || []).map((child: any) => this.normalizeTaskTree(child)),
      };
    }

    return {
      ...node,
      children: (node?.children || []).map((child: any) => this.normalizeTaskTree(child)),
    };
  }

  private async rawModuleRequest<T>(moduleId: string, inputs?: any): Promise<T> {
    try {
      const response = await this.client.post<T>(`/modules/${moduleId}`, inputs || {});
      return response.data;
    } catch (error: any) {
      throw this.toApiError(error);
    }
  }

  async generateTask(description: string): Promise<GenerateTaskResponse> {
    if (!description || description.trim() === '') {
      throw new Error('Description is required');
    }

    try {
      return await this.rawModuleRequest<GenerateTaskResponse>('apflow.generate', { requirement: description.trim() });
    } catch (error: any) {
      if ((error as any)?.code === 'MODULE_NOT_FOUND') {
        throw new Error('Task generation is not available on apflow v2. Create tasks manually or provide a task tree.');
      }
      throw error;
    }
  }

  async createTask(task: Omit<Task, 'id'>): Promise<CreateTaskResponse> {
    return this.moduleRequest<CreateTaskResponse>('apflow.task.create', task);
  }

  async createTasks(tasks: Task[] | Task): Promise<CreateTaskTreeResponse> {
    const taskArray = (Array.isArray(tasks) ? tasks : [tasks]).map((task) => {
      if (!task.schemas) return task;
      const { method, ...otherSchemas } = task.schemas;
      if (Object.keys(otherSchemas).length) {
        throw new Error('Task schema fields other than method are not supported by the REST creation API');
      }
      if (method && task.params?.executor_id && task.params.executor_id !== method) {
        throw new Error('Executor ID conflicts with schemas.method');
      }
      const { schemas: _schemas, ...definition } = task;
      return { ...definition, params: method ? { ...task.params, executor_id: method } : task.params };
    });
    return this.moduleRequest<CreateTaskTreeResponse>('apflow.task.create_tree', { tasks: taskArray });
  }

  async listExecutors(): Promise<Array<{ id: string; description: string }>> {
    const response = await this.client.get<{ modules: Array<{ module_id: string; description?: string }> }>('/modules');
    return response.data.modules
      .filter((module) => module.module_id.endsWith('_executor'))
      .map((module) => ({ id: module.module_id.replace(/^apflow\./, ''), description: module.description || '' }));
  }

  async getTask(taskId: string): Promise<Task> {
    if (!taskId) {
      throw new Error('Task ID is required');
    }
    return this.moduleRequest<Task>('apflow.task.get', { task_id: taskId });
  }

  async retryTask(taskId: string, idempotencyKey: string): Promise<{ run_id: string; root_task_id: string }> {
    const task = await this.getTask(taskId);
    if (task.parent_id) {
      throw new Error('Retry the root task instead of a child task');
    }
    const retry = await this.moduleRequest<{ run_id: string; root_task_id: string }>('apflow.run.retry', {
      run_id: task.run_id || task.id,
      idempotency_key: idempotencyKey,
    });
    try {
      await this.moduleRequest('apflow.task.submit', { task_id: retry.root_task_id });
    } catch (error: any) {
      throw new Error(`Retry created task ${retry.root_task_id}, but submission failed: ${error.message}`);
    }
    return retry;
  }

  async getTaskDetail(taskId: string): Promise<Task> {
    const response = await this.moduleRequest<{ task: any; children: any[] }>('apflow.task.tree', { task_id: taskId });
    return this.normalizeTaskTree(response);
  }

  async getTaskTree(taskId?: string): Promise<TaskTree> {
    if (!taskId) {
      throw new Error('Task ID is required');
    }
    const params: any = {};
    params.task_id = taskId;
    const response = await this.moduleRequest<{ task: any; children: any[] } | Task>('apflow.task.tree', params);
    return this.normalizeTaskTree(response) as TaskTree;
  }

  async updateTask(
    taskId: string,
    updates: {
      name?: string;
      status?: string;
      inputs?: Record<string, any>;
      params?: Record<string, any>;
      result?: any;
      error?: string;
      progress?: number;
      priority?: number;
      schedule_type?: string;
      schedule_expression?: string;
      schedule_enabled?: boolean;
      schedule_start_at?: string;
      schedule_end_at?: string;
      max_runs?: number;
    }
  ): Promise<Task> {
    const {
      schedule_type,
      schedule_expression,
      schedule_enabled,
      schedule_start_at: _scheduleStartAt,
      schedule_end_at: _scheduleEndAt,
      max_runs,
      ...taskUpdates
    } = updates;

    let updatedTask: Task | undefined;
    const hasTaskUpdates = Object.values(taskUpdates).some((value) => value !== undefined);
    if (hasTaskUpdates) {
      updatedTask = await this.moduleRequest<Task>('apflow.task.update', {
        task_id: taskId,
        ...taskUpdates,
      });
    }

    const hasScheduleUpdates =
      schedule_type !== undefined ||
      schedule_expression !== undefined ||
      schedule_enabled !== undefined ||
      max_runs !== undefined;

    if (!hasScheduleUpdates) {
      return updatedTask || this.getTask(taskId);
    }

    const currentTask = updatedTask || await this.getTask(taskId);
    const nextScheduleType = schedule_type ?? currentTask.schedule_type;
    const nextScheduleExpression = schedule_expression ?? currentTask.schedule_expression;

    if (!nextScheduleType || !nextScheduleExpression) {
      if (schedule_enabled === false) {
        return currentTask;
      }
      throw new Error('Schedule type and expression are required');
    }

    try {
      return await this.moduleRequest<Task>('apflow.schedule.set', {
        task_id: taskId,
        schedule_type: nextScheduleType,
        schedule_expression: nextScheduleExpression,
        schedule_enabled: schedule_enabled ?? currentTask.schedule_enabled ?? true,
        max_runs,
      });
    } catch (error: any) {
      if ((error as any)?.code !== 'MODULE_NOT_FOUND') {
        throw error;
      }

      return this.moduleRequest<Task>('apflow.task.update', {
        task_id: taskId,
        ...updates,
      });
    }
  }

  async deleteTask(taskId: string): Promise<{ task_id: string; deleted: boolean }> {
    return this.moduleRequest<{ task_id: string; deleted: boolean }>('apflow.task.delete', {
      task_id: taskId,
    });
  }

  async copyTask(taskId: string): Promise<{ root_task_id: string; task_count: number; origin_type: string }> {
    return this.moduleRequest<{ root_task_id: string; task_count: number; origin_type: string }>('apflow.task.copy', {
      task_id: taskId,
    });
  }

  private detectProviderFromTask(task: Task): string | undefined {
    const works = task.params?.works;
    if (works?.agents) {
      for (const agentConfig of Object.values(works.agents)) {
        const agent = agentConfig as any;
        const llm = agent?.llm;
        if (typeof llm === 'string') {
          return this.detectProviderFromModel(llm);
        }
      }
    }

    if (works?.llm && typeof works.llm === 'string') {
      return this.detectProviderFromModel(works.llm);
    }

    return undefined;
  }

  private detectProviderFromModel(modelName: string): string | undefined {
    if (!modelName) return undefined;

    const modelLower = modelName.toLowerCase();

    if (modelLower.includes('/')) {
      const provider = modelLower.split('/')[0];
      if (['openai', 'anthropic', 'google', 'gemini', 'azure', 'cohere', 'mistral', 'groq', 'together', 'ai21', 'replicate', 'ollama', 'deepinfra'].includes(provider)) {
        return provider;
      }
    }

    if (modelLower.includes('gpt-') || modelLower.includes('gpt')) return 'openai';
    if (modelLower.includes('claude')) return 'anthropic';
    if (modelLower.includes('gemini') || modelLower.includes('palm')) return 'google';
    if (modelLower.includes('command')) return 'cohere';
    if (modelLower.includes('mistral') || modelLower.includes('mixtral')) return 'mistral';
    if (modelLower.includes('llama')) return 'groq';
    if (modelLower.includes('j2-')) return 'ai21';
    if (modelLower.includes('togethercomputer')) return 'together';
    if (modelLower.includes('replicate')) return 'replicate';
    if (modelLower.includes('ollama')) return 'ollama';
    if (modelLower.includes('deepinfra')) return 'deepinfra';

    return undefined;
  }

  async executeTask(
    taskId: string,
    useStreaming = true,
    onEvent?: (event: TaskEvent) => void
  ): Promise<TaskExecutionResponse> {
    let provider: string | undefined;
    try {
      const task = await this.getTask(taskId);
      provider = this.detectProviderFromTask(task);
    } catch (error) {
      console.debug('Could not get task details for provider detection:', error);
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (typeof window !== 'undefined') {
      let llmKey: string | null = null;

      if (provider) {
        llmKey = localStorage.getItem(`llm_api_key_${provider}`);
      }

      if (!llmKey) {
        llmKey = localStorage.getItem('llm_api_key');
      }

      if (llmKey) {
        if (provider) {
          headers['X-LLM-API-KEY'] = `${provider}:${llmKey}`;
        } else {
          headers['X-LLM-API-KEY'] = llmKey;
        }
      }
    }

    if (useStreaming && onEvent && typeof window !== 'undefined' && typeof EventSource !== 'undefined') {
      const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
      const authHeaders: Record<string, string> = {};
      if (token) {
        authHeaders['Authorization'] = `Bearer ${token}`;
      }

      const allHeaders = { ...headers, ...authHeaders, 'Accept': 'text/event-stream' };

      const moduleId = this.resolveModuleCandidates('apflow.task.execute')[0];
      const response = await fetch(`${this.baseURL}/modules/${moduleId}`, {
        method: 'POST',
        headers: allHeaders,
        body: JSON.stringify({ task_id: taskId }),
        credentials: this.withCredentials ? 'include' : 'same-origin',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: { message: 'Unknown error' } }));
        if (this.isModuleNotFound({ response: { status: response.status, data: errorData } })) {
          return this.executeTask(taskId, false, onEvent);
        }
        throw new Error(errorData.error?.message || 'Unknown error');
      }

      const contentType = response.headers.get('content-type');
      if (contentType?.includes('text/event-stream')) {
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        if (!reader) {
          throw new Error('Response body is not readable');
        }

        let initialResponse: TaskExecutionResponse | null = null;

        const processStream = async () => {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6);
                try {
                  const parsed = JSON.parse(data);

                  if (parsed.type === 'result') {
                    initialResponse = {
                      success: true,
                      root_task_id: taskId,
                      task_id: taskId,
                      status: parsed.result?.status || 'completed',
                      message: 'Task execution completed',
                    };
                  } else if (parsed.type) {
                    onEvent(parsed);

                    if (parsed.final || parsed.type === 'stream_end') {
                      return initialResponse || {
                        success: true,
                        root_task_id: taskId,
                        task_id: taskId,
                        status: 'started',
                        message: 'Task execution started',
                      };
                    }
                  }
                } catch (e) {
                  console.error('Error parsing SSE data:', e, data);
                }
              }
            }
          }

          return initialResponse || {
            success: true,
            root_task_id: taskId,
            task_id: taskId,
            status: 'started',
            message: 'Task execution started',
          };
        };

        processStream().catch((error) => {
          console.error('Error processing SSE stream:', error);
          if (onEvent) {
            onEvent({
              type: 'error',
              error: error.message || 'Stream processing error',
            });
          }
        });

        return initialResponse || {
          success: true,
          root_task_id: taskId,
          task_id: taskId,
          status: 'started',
          message: 'Task execution started',
        };
      } else {
        const data = await response.json();
        if (data.error) {
          throw new Error(data.error.message || 'Unknown error');
        }
        return {
          success: true,
          root_task_id: taskId,
          task_id: taskId,
          status: data.status || 'completed',
          message: 'Task execution completed',
        };
      }
    }

    const data = await this.moduleRequest<{ task_id: string; status: string; result?: any; token_usage?: any }>(
      'apflow.task.execute',
      { task_id: taskId },
      { headers }
    );

    return {
      success: true,
      root_task_id: taskId,
      task_id: taskId,
      status: data.status || 'completed',
      message: 'Task execution completed',
    };
  }

  pollTaskStatus(
    taskId: string,
    onUpdate: (task: Task) => void,
    interval: number = 1000
  ): () => void {
    if (typeof window === 'undefined') {
      console.warn('Polling is not available in this environment');
      return () => {};
    }

    let isPolling = true;
    let pollInterval: NodeJS.Timeout | null = null;

    const poll = async () => {
      if (!isPolling) return;

      try {
        const task = await this.getTask(taskId);
        onUpdate(task);

        if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
          isPolling = false;
          if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
          }
        }
      } catch (error) {
        console.error('Error polling task status:', error);
      }
    };

    poll();
    pollInterval = setInterval(poll, interval);

    return () => {
      isPolling = false;
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
    };
  }

  async cancelTasks(taskIds: string[], force = false): Promise<{ results: Array<{ task_id: string; status: string; message?: string }> }> {
    return this.moduleRequest<{ results: Array<{ task_id: string; status: string; message?: string }> }>('apflow.task.cancel', {
      task_ids: taskIds,
    });
  }

  async getRunningTasks(userId?: string, limit = 100): Promise<{ tasks: RunningTask[]; count: number }> {
    return this.moduleRequest<{ tasks: RunningTask[]; count: number }>('apflow.task.running', {
      user_id: userId,
      limit,
    });
  }

  async listTasks(params?: {
    userId?: string;
    status?: string;
    root_only?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{ tasks: Task[]; total: number }> {
    return this.moduleRequest<{ tasks: Task[]; total: number }>('apflow.task.list', {
      user_id: params?.userId,
      status: params?.status,
      limit: params?.limit ?? 50,
      offset: params?.offset ?? 0,
    });
  }

  async getTaskChildren(parentId: string): Promise<{ children: Task[] }> {
    if (!parentId) {
      throw new Error('Parent task ID is required');
    }
    return this.moduleRequest<{ children: Task[] }>('apflow.task.children', { task_id: parentId });
  }

  async getRunningTaskStatus(taskIds: string[]): Promise<RunningTaskStatus[]> {
    return this.moduleRequest<RunningTaskStatus[]>('apflow.task.running', {
      task_ids: taskIds,
    });
  }

  async getRunningTaskCount(userId?: string): Promise<{ count: number; user_id?: string }> {
    return this.moduleRequest<{ count: number; user_id?: string }>('apflow.task.running', {
      user_id: userId,
    });
  }

  async getScheduledTasks(params?: {
    enabled_only?: boolean;
    schedule_type?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ tasks: ScheduledTask[]; count: number }> {
    return this.moduleRequest<{ tasks: ScheduledTask[]; count: number }>('apflow.task.scheduled', {
      enabled_only: params?.enabled_only ?? true,
      schedule_type: params?.schedule_type,
      limit: params?.limit ?? 20,
    });
  }

  async initSchedule(taskId: string, fromTime?: string): Promise<Task> {
    const task = await this.getTask(taskId);
    if (!task.schedule_type || !task.schedule_expression) {
      throw new Error('Schedule type and expression are required');
    }

    try {
      return await this.moduleRequest<Task>('apflow.schedule.set', {
        task_id: taskId,
        schedule_type: task.schedule_type,
        schedule_expression: task.schedule_expression,
        schedule_enabled: task.schedule_enabled ?? true,
        max_runs: task.max_runs,
      });
    } catch (error: any) {
      if ((error as any)?.code !== 'MODULE_NOT_FOUND') {
        throw error;
      }

      return this.moduleRequest<Task>('apflow.schedule.due', {
        task_id: taskId,
      });
    }
  }

  async completeScheduledRun(taskId: string, params?: {
    success?: boolean;
    result?: any;
  }): Promise<Task> {
    return this.moduleRequest<Task>('apflow.schedule.complete', {
      task_id: taskId,
      ...params,
    });
  }

  async exportIcal(params?: {
    schedule_type?: string;
    enabled_only?: boolean;
    limit?: number;
    calendar_name?: string;
  }): Promise<{ ical_content: string; task_count: number }> {
    const response = await this.moduleRequest<{ ical_content?: string; ical?: string; task_count?: number; count?: number }>('apflow.schedule.export_ical', {
      enabled_only: params?.enabled_only ?? true,
      schedule_type: params?.schedule_type,
      limit: params?.limit ?? 100,
      calendar_name: params?.calendar_name,
    });

    return {
      ical_content: response.ical_content ?? response.ical ?? '',
      task_count: response.task_count ?? response.count ?? 0,
    };
  }

  async triggerWebhook(taskId: string, params?: Record<string, any>): Promise<WebhookTriggerResponse> {
    return this.moduleRequest<WebhookTriggerResponse>('apflow.schedule.trigger', {
      task_id: taskId,
      ...params,
    });
  }

  async getHealth(): Promise<SystemHealth> {
    try {
      const response = await this.client.get('/healthz');
      return { status: response.data.status, version: '', uptime: 0 };
    } catch {
      return { status: 'unhealthy', version: '', uptime: 0 };
    }
  }

  async getAgentCard(): Promise<any> {
    const response = await this.client.get('/.well-known/agent-card');
    return response.data;
  }

  async setLLMKey(
    apiKey: string,
    provider?: string,
    userId?: string
  ): Promise<{ success: boolean; user_id: string; provider: string }> {
    try {
      return await this.moduleRequest<{ success: boolean; user_id: string; provider: string }>('apflow.config.llm_key.set', {
        api_key: apiKey,
        provider: provider,
        user_id: userId,
      });
    } catch (error: any) {
      if ((error as any)?.code === 'MODULE_NOT_FOUND') {
        throw new Error('Server-side LLM key storage is not available on this apflow server. Use request-header storage instead.');
      }
      throw error;
    }
  }

  async getLLMKeyStatus(
    provider?: string,
    userId?: string
  ): Promise<{ has_key: boolean; user_id: string; provider?: string; providers: Record<string, string>; server_available?: boolean }> {
    try {
      const status = await this.moduleRequest<{ has_key: boolean; user_id: string; provider?: string; providers: Record<string, string> }>(
        'apflow.config.llm_key.get',
        {
          provider: provider,
          user_id: userId,
        }
      );
      return { ...status, server_available: true };
    } catch (error: any) {
      if ((error as any)?.code === 'MODULE_NOT_FOUND') {
        return {
          has_key: false,
          user_id: userId || '',
          provider,
          providers: {},
          server_available: false,
        };
      }
      throw error;
    }
  }

  async deleteLLMKey(
    provider?: string,
    userId?: string
  ): Promise<{ success: boolean; user_id: string; deleted: boolean; provider: string }> {
    try {
      return await this.moduleRequest<{ success: boolean; user_id: string; deleted: boolean; provider: string }>(
        'apflow.config.llm_key.delete',
        {
          provider: provider,
          user_id: userId,
        }
      );
    } catch (error: any) {
      if ((error as any)?.code === 'MODULE_NOT_FOUND') {
        throw new Error('Server-side LLM key storage is not available on this apflow server.');
      }
      throw error;
    }
  }

}

export const apiClient = new AIPartnerUpFlowClient();
