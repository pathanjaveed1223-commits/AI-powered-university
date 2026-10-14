import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ArrowRight,
  BookOpen,
  BrainCircuit,
  FileText,
  FolderPlus,
  MessageSquareText,
  NotebookPen,
  Plus,
  Settings,
  Sparkles,
  Upload,
  Wand2,
  CheckCircle2,
  Trash2,
  Database,
  BarChart3,
  MessageCircleMore,
} from 'lucide-react';

type View = 'dashboard' | 'chat' | 'documents' | 'tools' | 'history' | 'settings';

type DocumentItem = {
  id: string;
  filename: string;
  type: string;
  size: number;
  uploaded_at: string | null;
  status: string;
  error_message?: string | null;
  chunk_count: number;
};

type Conversation = {
  id: string;
  title: string;
  updated_at?: string | null;
  created_at?: string | null;
};

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at?: string | null;
  metadata?: Record<string, unknown>;
};

type ChatResponse = {
  answer: string;
  citations: Array<{ filename: string; excerpt: string; score?: number }>;
  sources: Array<{ filename: string; excerpt: string }>;
  grounded: boolean;
  model: string;
};

const API_BASE = 'http://localhost:8001/api';

const navItems: Array<{ key: View; label: string; icon: typeof MessageSquareText }> = [
  { key: 'dashboard', label: 'Dashboard', icon: BarChart3 },
  { key: 'chat', label: 'AI Study Chat', icon: MessageSquareText },
  { key: 'documents', label: 'Documents', icon: FolderPlus },
  { key: 'tools', label: 'Study Tools', icon: BrainCircuit },
  { key: 'history', label: 'Chat History', icon: NotebookPen },
  { key: 'settings', label: 'Settings', icon: Settings },
];

const starterQuestions = [
  'Summarize the main concepts from my uploaded lecture notes.',
  'Explain this topic in simple terms for a beginner.',
  'What are the most important exam questions I should review?',
];

const studyTools = [
  { id: 'summarize', label: 'Summarize Notes' },
  { id: 'explain', label: 'Explain Simply' },
  { id: 'exam', label: 'Exam Preparation' },
  { id: 'quiz', label: 'Quiz Generator' },
  { id: 'flashcards', label: 'Flashcards' },
  { id: 'practice', label: 'Practice Test' },
  { id: 'topic', label: 'Topic Explorer' },
  { id: 'plan', label: 'Study Plan' },
];

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? {});
  if (!(init?.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function App() {
  const [activeView, setActiveView] = useState<View>('dashboard');
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [toolPrompt, setToolPrompt] = useState('Explain the main concepts and key revision points from my uploaded notes.');
  const [selectedTool, setSelectedTool] = useState('summarize');
  const [toolResult, setToolResult] = useState('');
  const [health, setHealth] = useState<{ selected_model: string; documents_count: number; indexed_chunks: number; ollama?: any } | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState('qwen3:4b');
  const [uploading, setUploading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [dragActive, setDragActive] = useState(false);

  const summaryCards = useMemo(
    () => [
      { label: 'Documents', value: documents.length.toString(), icon: FileText },
      { label: 'Indexed chunks', value: health?.indexed_chunks?.toString() ?? '0', icon: Database },
      { label: 'Conversations', value: conversations.length.toString(), icon: MessageCircleMore },
      { label: 'Current model', value: selectedModel, icon: Sparkles },
    ],
    [documents.length, conversations.length, health?.indexed_chunks, selectedModel],
  );

  const loadHealth = async () => {
    try {
      const payload = await fetchJson<{ status: string; selected_model: string; documents_count: number; indexed_chunks: number; ollama: any }>('/health');
      setHealth(payload);
      setSelectedModel(payload.selected_model || selectedModel);
    } catch (error) {
      console.error(error);
    }
  };

  const loadModels = async () => {
    try {
      const payload = await fetchJson<{ models: string[]; selected_model: string; ollama_status: any }>('/models');
      setModels(payload.models ?? []);
      setSelectedModel(payload.selected_model || selectedModel);
    } catch (error) {
      console.error(error);
    }
  };

  const loadDocuments = async () => {
    try {
      const payload = await fetchJson<{ documents: DocumentItem[] }>('/documents');
      setDocuments(payload.documents ?? []);
    } catch (error) {
      console.error(error);
    }
  };

  const loadConversations = async () => {
    try {
      const payload = await fetchJson<{ conversations: Conversation[] }>('/conversations');
      setConversations(payload.conversations ?? []);
      if (!selectedConversationId && payload.conversations?.length) {
        setSelectedConversationId(payload.conversations[0].id);
      }
    } catch (error) {
      console.error(error);
    }
  };

  const loadMessages = async (conversationId: string) => {
    try {
      const payload = await fetchJson<{ messages: Message[] }>(`/conversations/${conversationId}/messages`);
      setMessages(payload.messages ?? []);
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    const refresh = async () => {
      await Promise.all([loadHealth(), loadModels(), loadDocuments(), loadConversations()]);
    };
    refresh();
  }, []);

  useEffect(() => {
    if (selectedConversationId) {
      void loadMessages(selectedConversationId);
    }
  }, [selectedConversationId]);

  const createConversation = async () => {
    try {
      const payload = await fetchJson<{ id: string; title: string }>('/conversations', { method: 'POST' });
      setSelectedConversationId(payload.id);
      setMessages([]);
      setActiveView('chat');
      await loadConversations();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Could not create a conversation.');
    }
  };

  const sendChat = async () => {
    if (!chatInput.trim()) return;

    const question = chatInput.trim();
    let conversationId = selectedConversationId;

    if (!conversationId) {
      const payload = await fetchJson<{ id: string; title: string }>('/conversations', { method: 'POST' });
      conversationId = payload.id;
      setSelectedConversationId(payload.id);
      await loadConversations();
    }

    try {
      setLoading(true);
      const payload = await fetchJson<ChatResponse>('/chat/query', {
        method: 'POST',
        body: JSON.stringify({
          question,
          conversation_id: conversationId,
          model_name: selectedModel,
        }),
      });
      setChatInput('');
      await loadMessages(conversationId!);
      if (payload.answer) {
        setStatusMessage(payload.grounded ? 'Answer generated from uploaded documents.' : 'No grounded evidence found.');
      }
      await loadHealth();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to generate response.');
    } finally {
      setLoading(false);
    }
  };

  const deleteConversation = async (conversationId: string) => {
    try {
      await fetchJson(`/conversations/${conversationId}`, { method: 'DELETE' });
      const nextList = conversations.filter((conversation) => conversation.id !== conversationId);
      setConversations(nextList);
      if (selectedConversationId === conversationId) {
        setSelectedConversationId(nextList[0]?.id ?? null);
        setMessages([]);
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Unable to delete conversation.');
    }
  };

  const handleSelectModel = async (modelName: string) => {
    try {
      const payload = await fetchJson<{ selected_model: string }>('/models/select', {
        method: 'POST',
        body: JSON.stringify({ model_name: modelName }),
      });
      setSelectedModel(payload.selected_model);
      setStatusMessage(`Model switched to ${payload.selected_model}.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Unable to switch model.');
    }
  };

  const handleUpload = async (file: File) => {
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
      setUploading(true);
      setStatusMessage(`Uploading ${file.name}...`);
      const response = await fetch(`http://localhost:8001/api/documents/upload`, {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Upload failed.');
      }
      await loadDocuments();
      await loadHealth();
      setStatusMessage(`Uploaded ${file.name}.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Document upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const deleteDocument = async (documentId: string) => {
    try {
      await fetchJson(`/documents/${documentId}`, { method: 'DELETE' });
      await loadDocuments();
      await loadHealth();
      setStatusMessage('Document deleted and indexed vectors removed.');
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Unable to delete document.');
    }
  };

  const runStudyTool = async () => {
    try {
      setLoading(true);
      const payload = await fetchJson<ChatResponse>('/study-tools/generate', {
        method: 'POST',
        body: JSON.stringify({
          tool_name: selectedTool,
          topic: toolPrompt,
          model_name: selectedModel,
        }),
      });
      setToolResult(payload.answer);
      setStatusMessage('Study tool generated successfully.');
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Study tool failed to generate.');
    } finally {
      setLoading(false);
    }
  };

  const recentDocuments = documents.slice(0, 4);
  const recentChats = conversations.slice(0, 4);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800">
      <div className="flex min-h-screen">
        <aside className="w-full max-w-[280px] border-r border-slate-200 bg-slate-900 text-slate-50 p-5">
          <div className="mb-8 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-200">
              <BookOpen className="h-5 w-5" />
            </div>
            <div>
              <p className="text-lg font-bold">UniMind AI</p>
              <p className="text-xs text-slate-400">Learning Assistant</p>
            </div>
          </div>

          <nav className="space-y-2">
            {navItems.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveView(key)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition ${
                  activeView === key ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </nav>

          <div className="mt-8 rounded-2xl border border-slate-700 bg-slate-800 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Quick actions</p>
            <button
              type="button"
              onClick={createConversation}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-500 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-400"
            >
              <Plus className="h-4 w-4" />
              New chat
            </button>
          </div>
        </aside>

        <main className="flex-1 overflow-auto p-6">
          {activeView === 'dashboard' && (
            <div className="space-y-6">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm uppercase tracking-[0.18em] text-indigo-600">Student dashboard</p>
                  <h1 className="mt-2 text-3xl font-bold text-slate-900">Welcome back, learner</h1>
                </div>
                <button
                  type="button"
                  onClick={createConversation}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
                >
                  <MessageSquareText className="h-4 w-4" />
                  Start new chat
                </button>
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {summaryCards.map(({ label, value, icon: Icon }) => (
                  <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="mb-4 flex items-center justify-between">
                      <span className="text-sm text-slate-500">{label}</span>
                      <div className="rounded-xl bg-indigo-50 p-2 text-indigo-600">
                        <Icon className="h-4 w-4" />
                      </div>
                    </div>
                    <p className="text-3xl font-bold text-slate-900">{value}</p>
                  </div>
                ))}
              </div>

              <div className="grid gap-6 xl:grid-cols-[1.5fr,1fr]">
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-xl font-semibold">Quick actions</h2>
                    <Sparkles className="h-5 w-5 text-indigo-500" />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {['AI Study Chat', 'Upload notes', 'Study tools', 'Model settings'].map((action) => (
                      <button
                        key={action}
                        type="button"
                        onClick={() => setActiveView(action === 'AI Study Chat' ? 'chat' : action === 'Upload notes' ? 'documents' : action === 'Study tools' ? 'tools' : 'settings')}
                        className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-left text-sm font-medium text-slate-700 transition hover:border-indigo-200 hover:bg-indigo-50"
                      >
                        {action}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h2 className="text-xl font-semibold">Getting started</h2>
                  <ul className="mt-4 space-y-3 text-sm text-slate-600">
                    <li>1. Upload PDFs, DOCX, TXT, or Markdown notes.</li>
                    <li>2. Ask study questions in the chat assistant.</li>
                    <li>3. Use study tools to summarize, quiz, and plan revision.</li>
                  </ul>
                </div>
              </div>

              <div className="grid gap-6 xl:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h2 className="text-xl font-semibold">Recent documents</h2>
                  <div className="mt-4 space-y-3">
                    {recentDocuments.length ? (
                      recentDocuments.map((doc) => (
                        <div key={doc.id} className="flex items-center justify-between rounded-xl border border-slate-200 p-3">
                          <div>
                            <p className="font-medium text-slate-800">{doc.filename}</p>
                            <p className="text-xs text-slate-500">{formatBytes(doc.size)} • {doc.chunk_count} chunks</p>
                          </div>
                          <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700">{doc.status}</span>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-slate-500">No documents uploaded yet.</p>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h2 className="text-xl font-semibold">Recent chats</h2>
                  <div className="mt-4 space-y-3">
                    {recentChats.length ? (
                      recentChats.map((conversation) => (
                        <button
                          key={conversation.id}
                          type="button"
                          onClick={() => {
                            setSelectedConversationId(conversation.id);
                            setActiveView('chat');
                          }}
                          className="w-full rounded-xl border border-slate-200 p-3 text-left transition hover:bg-slate-50"
                        >
                          <p className="font-medium text-slate-800">{conversation.title}</p>
                          <p className="text-xs text-slate-500">{conversation.updated_at ?? 'Recently updated'}</p>
                        </button>
                      ))
                    ) : (
                      <p className="text-sm text-slate-500">No conversations yet.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeView === 'chat' && (
            <div className="grid h-full gap-6 xl:grid-cols-[0.9fr,2.1fr]">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-xl font-semibold">Chat history</h2>
                  <button type="button" onClick={createConversation} className="rounded-lg bg-slate-900 p-2 text-white">
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                <div className="space-y-2">
                  {conversations.length ? (
                    conversations.map((conversation) => (
                      <div key={conversation.id} className={`rounded-xl border p-3 ${selectedConversationId === conversation.id ? 'border-indigo-200 bg-indigo-50' : 'border-slate-200 bg-slate-50'}`}>
                        <button type="button" onClick={() => setSelectedConversationId(conversation.id)} className="block w-full text-left">
                          <p className="font-medium text-slate-800">{conversation.title}</p>
                          <p className="mt-1 text-xs text-slate-500">{conversation.updated_at ?? 'Recently'}</p>
                        </button>
                        <button type="button" onClick={() => deleteConversation(conversation.id)} className="mt-2 inline-flex items-center gap-1 text-xs text-red-600">
                          <Trash2 className="h-3.5 w-3.5" /> Delete
                        </button>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-slate-500">No conversations yet.</p>
                  )}
                </div>
              </div>

              <div className="flex min-h-[650px] flex-col rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                  <div>
                    <h2 className="text-xl font-semibold">AI Study Chat</h2>
                    <p className="text-xs text-slate-500">Grounded answers from your uploaded course material</p>
                  </div>
                  <div className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-medium text-indigo-700">
                    {selectedModel}
                  </div>
                </div>

                <div className="flex-1 space-y-4 overflow-auto p-5">
                  {messages.length ? (
                    messages.map((message) => (
                      <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${message.role === 'user' ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-slate-50 text-slate-800'}`}>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5">
                      <p className="font-medium text-slate-800">Start with a question</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {starterQuestions.map((question) => (
                          <button
                            key={question}
                            type="button"
                            onClick={() => setChatInput(question)}
                            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:border-indigo-200 hover:bg-indigo-50"
                          >
                            {question}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="border-t border-slate-200 p-4">
                  <div className="mb-3 flex gap-2">
                    {starterQuestions.slice(0, 2).map((question) => (
                      <button key={question} type="button" onClick={() => setChatInput(question)} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-200">
                        {question}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-3">
                    <textarea
                      value={chatInput}
                      onChange={(event) => setChatInput(event.target.value)}
                      rows={3}
                      className="flex-1 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm outline-none focus:border-indigo-200 focus:ring-2 focus:ring-indigo-100"
                      placeholder="Ask about your uploaded notes, lectures, or study material..."
                    />
                    <button
                      type="button"
                      onClick={sendChat}
                      disabled={loading}
                      className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
                    >
                      <ArrowRight className="h-4 w-4" />
                      {loading ? 'Thinking...' : 'Ask'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeView === 'documents' && (
            <div className="space-y-6">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-xl font-semibold">Document library</h2>
                  <div className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700">
                    {documents.length} files
                  </div>
                </div>

                <div
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragActive(true);
                  }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragActive(false);
                    const files = Array.from(event.dataTransfer.files ?? []);
                    files.forEach((file) => void handleUpload(file));
                  }}
                  className={`rounded-2xl border border-dashed p-8 text-center ${dragActive ? 'border-indigo-400 bg-indigo-50' : 'border-slate-300 bg-slate-50'}`}
                >
                  <Upload className="mx-auto mb-3 h-8 w-8 text-indigo-600" />
                  <p className="font-medium text-slate-800">Drop files here or click to upload</p>
                  <p className="mt-1 text-sm text-slate-500">PDF, DOCX, TXT, and Markdown supported</p>
                  {uploading && <p className="mt-3 text-sm font-medium text-indigo-600">Uploading files...</p>}
                  <input
                    type="file"
                    multiple
                    onChange={(event) => {
                      const files = Array.from(event.target.files ?? []);
                      files.forEach((file) => void handleUpload(file));
                    }}
                    className="mt-4 block w-full text-sm text-slate-500 file:mr-4 file:rounded-xl file:border-0 file:bg-indigo-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-lg font-semibold">Uploaded documents</h3>
                <div className="mt-4 space-y-3">
                  {documents.length ? (
                    documents.map((document) => (
                      <div key={document.id} className="flex flex-col gap-3 rounded-xl border border-slate-200 p-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="font-medium text-slate-800">{document.filename}</p>
                          <p className="text-xs text-slate-500">{document.type} • {formatBytes(document.size)} • {document.chunk_count} chunks</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700">{document.status}</span>
                          <button type="button" onClick={() => deleteDocument(document.id)} className="rounded-lg bg-red-50 p-2 text-red-600 hover:bg-red-100">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-slate-500">No files uploaded yet.</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeView === 'tools' && (
            <div className="space-y-6">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-xl font-semibold">Study tools</h2>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {studyTools.map((tool) => (
                    <button
                      key={tool.id}
                      type="button"
                      onClick={() => setSelectedTool(tool.id)}
                      className={`rounded-xl border p-3 text-left text-sm transition ${selectedTool === tool.id ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'}`}
                    >
                      {tool.label}
                    </button>
                  ))}
                </div>

                <div className="mt-5 space-y-4">
                  <textarea
                    value={toolPrompt}
                    onChange={(event) => setToolPrompt(event.target.value)}
                    rows={5}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 outline-none focus:border-indigo-200 focus:ring-2 focus:ring-indigo-100"
                  />
                  <button type="button" onClick={runStudyTool} disabled={loading} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60">
                    {loading ? 'Generating...' : 'Generate study output'}
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-2 flex items-center gap-2">
                  <Wand2 className="h-5 w-5 text-indigo-600" />
                  <h3 className="text-lg font-semibold">AI-generated study output</h3>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-7 text-slate-700">
                  {toolResult ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{toolResult}</ReactMarkdown>
                  ) : (
                    <p className="text-slate-500">Your generated summary, flashcards, or quiz will appear here.</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeView === 'history' && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-xl font-semibold">Conversation history</h2>
              <div className="mt-4 space-y-3">
                {conversations.length ? (
                  conversations.map((conversation) => (
                    <div key={conversation.id} className="flex items-center justify-between rounded-xl border border-slate-200 p-3">
                      <button type="button" onClick={() => { setSelectedConversationId(conversation.id); setActiveView('chat'); }} className="text-left">
                        <p className="font-medium text-slate-800">{conversation.title}</p>
                        <p className="text-xs text-slate-500">Updated {conversation.updated_at ?? 'recently'}</p>
                      </button>
                      <button type="button" onClick={() => deleteConversation(conversation.id)} className="rounded-lg bg-red-50 p-2 text-red-600 hover:bg-red-100">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-500">No saved conversations yet.</p>
                )}
              </div>
            </div>
          )}

          {activeView === 'settings' && (
            <div className="space-y-6">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-xl font-semibold">Model settings</h2>
                <div className="mt-4 space-y-4">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">Available local models</label>
                    <select value={selectedModel} onChange={(event) => void handleSelectModel(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                      {models.length ? models.map((modelName) => <option key={modelName} value={modelName}>{modelName}</option>) : ['qwen3:4b', 'qwen2.5:3b'].map((modelName) => <option key={modelName} value={modelName}>{modelName}</option>)}
                    </select>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                    <p className="font-medium">Ollama status</p>
                    <div className="mt-2 flex items-center gap-2">
                      <CheckCircle2 className={health?.ollama?.ok ? 'h-4 w-4 text-emerald-600' : 'h-4 w-4 text-amber-600'} />
                      {health?.ollama?.ok ? `Connected to ${health.ollama.base_url}` : 'Ollama is not running or a model is unavailable.'}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {statusMessage && (
            <div className="fixed bottom-5 right-5 max-w-md rounded-xl border border-indigo-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-lg">
              {statusMessage}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
