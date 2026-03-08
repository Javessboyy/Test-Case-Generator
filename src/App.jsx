import React, { useState, useCallback, useMemo, useRef } from 'react';
import { Upload, FileText, Download, Copy, ChevronDown, ChevronUp, Loader2, CheckCircle, AlertCircle, AlertTriangle, Shield, Check } from 'lucide-react';

const SYSTEM_PROMPT = `You are a senior QA engineer. Read the Backend technical documentation and generate thorough API test cases. Return ONLY a valid JSON array — no markdown, no backticks, no explanation. Each object must have: test_id (string, e.g. TC-001), title (string), preconditions (string), steps (array of strings), expected_result (string), category (one of: positive / negative / edge / auth), endpoint (string). Generate 15–25 test cases covering happy paths, negative cases, edge cases, and auth/permission scenarios.`;

const CATEGORY_STYLES = {
  positive: 'text-primary border-primary',
  negative: 'text-negative border-negative',
  edge: 'text-edge border-edge',
  auth: 'text-auth border-auth'
};

const CATEGORY_ICONS = {
  positive: <CheckCircle size={16} className="text-primary" />,
  negative: <AlertCircle size={16} className="text-negative" />,
  edge: <AlertTriangle size={16} className="text-edge" />,
  auth: <Shield size={16} className="text-auth" />
};

export default function App() {
  const [apiKey, setApiKey] = useState(localStorage.getItem('ANTHROPIC_API_KEY') || '');
  const [file, setFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [testCases, setTestCases] = useState([]);
  const [filter, setFilter] = useState('All');
  const [expandedCards, setExpandedCards] = useState({});
  const [copied, setCopied] = useState(false);

  const fileInputRef = useRef(null);

  const handleApiKeyChange = (e) => {
    const key = e.target.value;
    setApiKey(key);
    localStorage.setItem('ANTHROPIC_API_KEY', key);
  };

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const validateAndSetFile = (selectedFile) => {
    if (selectedFile && selectedFile.type === 'application/pdf') {
      setFile(selectedFile);
      setError(null);
    } else {
      setFile(null);
      setError('Please upload a valid PDF file.');
    }
  };

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files[0];
    validateAndSetFile(droppedFile);
  }, []);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    validateAndSetFile(selectedFile);
  };

  const readFileAsBase64 = useCallback((file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64String = reader.result.split(',')[1];
        resolve(base64String);
      };
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(file);
    });
  }, []);

  const handleGenerate = async () => {
    if (!apiKey) {
      setError('Anthropic API Key is required.');
      return;
    }
    if (!file) {
      setError('Please provide a PDF file.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setTestCases([]);
    setExpandedCards({});

    try {
      const base64Pdf = await readFileAsBase64(file);

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022', // updated to claude-3-5 since 4 is not out
          max_tokens: 8000,
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'document',
                  source: {
                    type: 'base64',
                    media_type: 'application/pdf',
                    data: base64Pdf
                  }
                },
                {
                  type: 'text',
                  text: 'Generate API test cases based on this backend documentation.'
                }
              ]
            }
          ]
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error?.message || 'Failed to generate test cases.');
      }

      const data = await response.json();
      let assistantMessage = data.content[0].text;

      // Strip markdown fences
      assistantMessage = assistantMessage.replace(/^```(json)?|```$/gm, '').trim();

      const parsedCases = JSON.parse(assistantMessage);
      if (Array.isArray(parsedCases)) {
        setTestCases(parsedCases);
      } else {
        throw new Error('AI response was not a valid JSON array.');
      }
    } catch (err) {
      console.error(err);
      setError(`Error: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredCases = useMemo(() => {
    if (filter === 'All') return testCases;
    return testCases.filter((tc) => tc.category.toLowerCase() === filter.toLowerCase());
  }, [testCases, filter]);

  const categoryCounts = useMemo(() => {
    const counts = { All: testCases.length, Positive: 0, Negative: 0, Edge: 0, Auth: 0 };
    testCases.forEach((tc) => {
      const cat = tc.category?.toLowerCase();
      if (cat === 'positive') counts.Positive++;
      if (cat === 'negative') counts.Negative++;
      if (cat === 'edge') counts.Edge++;
      if (cat === 'auth') counts.Auth++;
    });
    return counts;
  }, [testCases]);

  const toggleCard = (id) => {
    setExpandedCards((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const exportCSV = () => {
    if (testCases.length === 0) return;
    const headers = ['Test ID', 'Category', 'Title', 'Endpoint', 'Preconditions', 'Expected Result', 'Steps'];
    const rows = testCases.map(tc => [
      tc.test_id,
      tc.category,
      `"${tc.title.replace(/"/g, '""')}"`,
      tc.endpoint,
      `"${tc.preconditions.replace(/"/g, '""')}"`,
      `"${tc.expected_result.replace(/"/g, '""')}"`,
      `"${tc.steps.join('\\n').replace(/"/g, '""')}"`
    ]);
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'test_cases.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const copyAll = async () => {
    if (testCases.length === 0) return;
    const textToCopy = JSON.stringify(testCases, null, 2);
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy', err);
    }
  };

  return (
    <div className="min-h-screen relative font-mono text-sm pb-12">
      <div className="scanlines"></div>

      <main className="max-w-5xl mx-auto px-4 py-8 relative z-10">
        <header className="mb-10 text-center border-b border-gray-800 pb-6">
          <h1 className="text-3xl font-bold text-primary mb-2 flex items-center justify-center gap-3">
            <span className="bg-primary text-background px-2 py-1 select-none">TCG</span>
            Test Case Generator
          </h1>
          <p className="text-gray-400">AI-powered internal QA tool for backend API documentation</p>
        </header>

        <section className="mb-8 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-1 flex flex-col gap-4">
            <div className="bg-[#0c121b] border border-gray-800 p-4 rounded-sm">
              <label className="block text-primary mb-2 text-xs uppercase tracking-wider">Anthropic API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={handleApiKeyChange}
                placeholder="sk-ant-..."
                className="w-full bg-background border border-gray-700 px-3 py-2 text-gray-200 focus:outline-none focus:border-primary transition-colors"
              />
              <p className="text-xs text-gray-500 mt-2">Stored locally in your browser.</p>
            </div>

            <div
              className={`bg-[#0c121b] border-2 border-dashed p-6 rounded-sm text-center transition-all ${isDragging ? 'border-primary bg-primary/5' : 'border-gray-700 hover:border-gray-500'} ${file ? 'border-primary' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                className="hidden"
                accept="application/pdf"
              />

              {!file ? (
                <div className="flex flex-col items-center gap-3 cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="text-gray-400" size={32} />
                  <div>
                    <span className="text-primary hover:underline">Click to upload</span> or drag and drop
                  </div>
                  <div className="text-xs text-gray-500">PDF documents only</div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <FileText className="text-primary" size={32} />
                  <div className="text-gray-200 truncate w-full max-w-[200px]" title={file.name}>{file.name}</div>
                  <div className="text-xs text-gray-500">{(file.size / 1024 / 1024).toFixed(2)} MB</div>
                  <button
                    onClick={() => setFile(null)}
                    className="text-xs text-negative hover:underline mt-1"
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>

            <button
              onClick={handleGenerate}
              disabled={isLoading || !file || !apiKey}
              className={`w-full py-3 px-4 font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all ${isLoading || !file || !apiKey
                  ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                  : 'bg-primary text-background hover:bg-[#00e67a] shadow-[0_0_15px_rgba(0,255,136,0.3)] hover:shadow-[0_0_20px_rgba(0,255,136,0.5)]'
                }`}
            >
              {isLoading ? (
                <>
                  <Loader2 className="animate-spin" size={18} />
                  Processing...
                </>
              ) : (
                'Generate Test Cases'
              )}
            </button>

            {error && (
              <div className="bg-negative/10 border border-negative p-3 text-negative text-xs flex gap-2 items-start">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                <span className="break-all">{error}</span>
              </div>
            )}
          </div>

          <div className="md:col-span-2 flex flex-col h-full min-h-[500px]">
            {testCases.length > 0 ? (
              <div className="bg-[#0c121b] border border-gray-800 flex flex-col h-full rounded-sm overflow-hidden">
                <div className="border-b border-gray-800 p-3 bg-black flex flex-wrap gap-2 items-center justify-between">
                  <div className="flex flex-wrap gap-2">
                    {['All', 'Positive', 'Negative', 'Edge', 'Auth'].map(tab => (
                      <button
                        key={tab}
                        onClick={() => setFilter(tab)}
                        className={`px-3 py-1 text-xs uppercase tracking-wider transition-colors border ${filter === tab
                            ? 'border-primary text-primary bg-primary/10'
                            : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-700'
                          }`}
                      >
                        {tab} [{categoryCounts[tab]}]
                      </button>
                    ))}
                  </div>

                  <div className="flex gap-2 ml-auto">
                    <button
                      onClick={copyAll}
                      className="p-1.5 text-gray-400 hover:text-primary transition-colors flex items-center gap-1.5 text-xs"
                      title="Copy JSON"
                    >
                      {copied ? <Check size={14} className="text-primary" /> : <Copy size={14} />}
                      <span className="hidden sm:inline">{copied ? 'Copied!' : 'Copy'}</span>
                    </button>
                    <button
                      onClick={exportCSV}
                      className="p-1.5 text-gray-400 hover:text-primary transition-colors flex items-center gap-1.5 text-xs"
                      title="Export CSV"
                    >
                      <Download size={14} />
                      <span className="hidden sm:inline">CSV</span>
                    </button>
                  </div>
                </div>

                <div className="flex-1 p-4 overflow-y-auto space-y-3 custom-scrollbar">
                  {filteredCases.map((tc) => {
                    const isExpanded = expandedCards[tc.test_id];
                    const catLower = tc.category?.toLowerCase() || 'positive';
                    const colorClass = CATEGORY_STYLES[catLower] || CATEGORY_STYLES.positive;
                    const icon = CATEGORY_ICONS[catLower] || CATEGORY_ICONS.positive;

                    return (
                      <div key={tc.test_id} className="border border-gray-800 bg-background overflow-hidden transition-all duration-200">
                        <div
                          className="p-3 flex items-start gap-3 cursor-pointer hover:bg-gray-900 transition-colors select-none"
                          onClick={() => toggleCard(tc.test_id)}
                        >
                          <div className="pt-0.5 shrink-0">{icon}</div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-bold text-gray-300">{tc.test_id}</span>
                              <span className={`text-[10px] uppercase px-1.5 py-0.5 border ${colorClass} bg-opacity-10 opacity-80`}>
                                {tc.category}
                              </span>
                              <span className="text-xs text-gray-500 font-mono truncate ml-2 px-1.5 py-0.5 bg-gray-900 rounded-sm">
                                {tc.endpoint}
                              </span>
                            </div>
                            <div className="text-gray-400 line-clamp-1">{tc.title}</div>
                          </div>
                          <div className="text-gray-500 shrink-0">
                            {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="p-4 border-t border-gray-800 bg-[#06080c] text-sm flex flex-col gap-4">
                            <div>
                              <div className="text-xs uppercase text-gray-500 mb-1">Preconditions</div>
                              <div className="text-gray-300 bg-black p-2 rounded-sm border border-gray-800">{tc.preconditions}</div>
                            </div>
                            <div>
                              <div className="text-xs uppercase text-gray-500 mb-1">Steps</div>
                              <ol className="list-decimal list-inside text-gray-300 bg-black p-2 rounded-sm border border-gray-800 space-y-1">
                                {tc.steps.map((step, i) => <li key={i}>{step}</li>)}
                              </ol>
                            </div>
                            <div>
                              <div className="text-xs uppercase text-gray-500 mb-1">Expected Result</div>
                              <div className="text-primary bg-primary/5 p-2 rounded-sm border border-primary/20">{tc.expected_result}</div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {filteredCases.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-2 py-12">
                      <AlertCircle size={24} className="opacity-50" />
                      <p>No test cases found for this category.</p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-gray-600 border border-dashed border-gray-800 bg-[#0c121b] p-8 rounded-sm">
                <div className="w-16 h-16 bg-gray-900 rounded-full flex items-center justify-center mb-4">
                  <Shield size={24} className="text-gray-700" />
                </div>
                <h3 className="text-lg font-bold text-gray-400 mb-2">Awaiting Documentation</h3>
                <p className="text-center max-w-sm text-xs">
                  Upload a backend technical design PDF and hit generate. The AI will extract up to 25 detailed API test cases tailored to your specifications.
                </p>
              </div>
            )}
          </div>
        </section>
      </main>

      <style dangerouslySetInnerHTML={{
        __html: `
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: #0c121b; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #334155; border-radius: 3px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #475569; }
      `}} />
    </div>
  );
}
