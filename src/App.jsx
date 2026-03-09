import React, { useState, useCallback, useMemo, useRef } from 'react';
import { Upload, FileText, Download, Copy, ChevronDown, ChevronUp, Loader2, CheckCircle, AlertCircle, AlertTriangle, Shield, Check } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';

// Import worker
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Set PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const SYSTEM_PROMPT = `You are a senior QA engineer specializing in API testing.

CRITICAL: Read the ENDPOINT DOCUMENTATION section below carefully before generating test cases.

-------------------------------------------
ENDPOINT DOCUMENTATION
-------------------------------------------

[REPLACE THIS ENTIRE BLOCK WITH YOUR ENDPOINT DOCUMENTATION]

Include:
- Endpoint path & HTTP method
- Auth type (Basic Auth, Bearer, Signature, etc.)
- Path/query parameters with types and required/optional
- Request headers
- Response structure (full JSON example)
- Business logic / rules
- DB query (if available)
- Error codes (if available)

-------------------------------------------
TEST CASE GENERATION RULES
-------------------------------------------

Analyze the documentation above and generate exhaustive test cases.
There are only THREE categories: "positive", "negative", and "edge".
DO NOT create a separate "auth" category — all auth scenarios must go inside positive or negative.

------------------------------------------
POSITIVE — cover all of these:
------------------------------------------
FUNCTIONAL:
- Happy path with all valid inputs and valid auth
- Each valid variation of path/query parameters individually
- Boundary values (min valid, max valid)
- Every possible valid status/category value in response
- User exists with data ? verify response array is populated
- User exists with no matching data ? verify response array is empty []
- All response fields present with correct types and values
- Response metadata fields (version, api_status, api_env) present and non-null
- response_code = "000000" on success
- Business logic rules each verified individually as separate test cases

AUTH (inside positive):
- Valid Basic Auth + valid Signature ? full success
- Basic Auth credentials with minimum valid format
- Basic Auth credentials with long valid username:password
- Valid auth on repeated requests ? consistent result

------------------------------------------
NEGATIVE — each must isolate exactly ONE invalid variable:
------------------------------------------
PATH PARAMETER:
- Each required path parameter: missing, empty string, whitespace only
- Each required path parameter: wrong type (string, float, boolean, null literal)
- Each required path parameter: invalid format (special chars, SQL injection pattern, XSS pattern, path traversal, emoji, unicode)
- Each required path parameter: non-existent resource (valid format but no DB record)
- Each required path parameter: boundary violations (0, negative, extremely large number, extremely long string >1000 chars)

HTTP METHOD:
- POST instead of correct method (same valid auth and params)
- PUT instead of correct method
- DELETE instead of correct method
- PATCH instead of correct method

AUTH — Basic Auth (each as its own separate test case):
- Missing Authorization header entirely (no header key at all)
- Authorization header present but empty value ""
- Wrong auth scheme: "Bearer abc123" instead of "Basic ..."
- Wrong auth scheme: "Token abc123" instead of "Basic ..."
- Basic Auth wrong username only (correct password) — base64 of "wronguser:password"
- Basic Auth wrong password only (correct username) — base64 of "username:wrongpass"
- Basic Auth both wrong username and wrong password — base64 of "wronguser:wrongpass"
- Basic Auth empty username only — base64 of ":password" ? "OnBhc3N3b3Jk"
- Basic Auth empty password only — base64 of "username:" ? "dXNlcm5hbWU6"
- Basic Auth empty username and empty password — base64 of ":" ? "Og=="
- Basic Auth malformed base64 value — "!!!notbase64!!!"
- Basic Auth valid credentials but no space after "Basic" keyword ? "Basicdxnlcm5hbWU6cGFzc3dvcmQ="

AUTH — Signature Header (each as its own separate test case):
- Missing Signature header entirely (Authorization valid, Signature header absent)
- Signature header present but empty value ""
- Signature header with completely random/wrong value — "Kitabisa t=1700000000,v1=wrongvalue123"
- Signature header with expired timestamp — "Kitabisa t=1600000000,v1=abc123def456"
- Signature header with future timestamp — "Kitabisa t=9999999999,v1=abc123def456"
- Signature generated for different endpoint path (e.g., /v1/internal/other-endpoint)
- Signature generated for different resource ID (e.g., user_id=99999 but path uses 11111)
- Signature header malformed structure (missing "t=" component)
- Signature header malformed structure (missing "v1=" component)
- Valid Basic Auth + valid Signature but generated for wrong environment

------------------------------------------
EDGE — boundary and unusual scenarios:
------------------------------------------
- Resource with exactly 1 result item in data array
- Resource with large number of result items (50+) — verify no truncation
- Resource exists but all records filtered out by business logic ? data = []
- Records with non-active statuses exist ? verify they are excluded from response
- Concurrent identical requests ? verify consistent response (no race condition)
- Extra unknown headers in request ? verify response is not affected
- response_code is string type "000000" not integer 0
- id field in data items is integer type, not string
- status field value is exactly "ACTIVE" or "INACTIVE_INSUFFICIENT_BALANCE" (case-sensitive)
- category field value is exactly "DIRECT_TO_CAMPAIGN" for direct donations (case-sensitive)
- No extra undocumented fields present in response data items
- data field is array type, not null and not object

-------------------------------------------
STRICT RULES
-------------------------------------------
- ZERO duplicate test cases — every test_id, title, and scenario must be completely unique
- NO limit on number of test cases — generate as many as needed for full coverage
- Only THREE categories allowed: "positive", "negative", "edge" — never use "auth"
- Each NEGATIVE test isolates exactly ONE invalid variable — never combine two invalid inputs in one test
- Each step must use concrete real values — actual integers, actual base64 strings, actual header names and values
- Never use placeholders like "your_token", "example_value", or "<insert_here>"
- Extract concrete example values from the documentation provided and use them throughout
- Every business logic rule must have its own dedicated test case
- Every response field must have its own type and value validation test case
- All auth scenarios belong inside "positive" or "negative" — never in a separate category

Return ONLY a valid JSON array with NO markdown, NO backticks, NO explanation.

Each test case must have:
- test_id: Unique sequential ID (e.g., TC-001, TC-002, TC-003)
- title: Specific descriptive title that uniquely identifies this scenario — must mention what is being tested and what is invalid/valid
- preconditions: Exact DB state and auth state required before running the test
- steps: Array of minimum 5 detailed steps — each step includes exact header values, exact path used, exact body, and precise assertion for that step
- expected_result: Exact HTTP status code + exact response body expectations with specific field types and values
- category: "positive", "negative", or "edge" only
- endpoint: Full endpoint with method (e.g., GET /v1/internal/auto-donation/:user_id/active-schedules)
- request_payload: Concrete object with actual parameter values and actual header values used in this test — never use placeholders
- expected_status: Expected HTTP status code as integer`;

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

  const readFileAsText = useCallback(async (file) => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      text += textContent.items.map(item => item.str).join(' ') + '\n';
    }
    return text;
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
      let pdfText = await readFileAsText(file);

      // Sanitize PDF text - remove problematic characters
      pdfText = pdfText
        .replace(/\0/g, '')                    // Remove null bytes
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '') // Remove control characters
        .replace(/[\p{Cc}\p{Cn}]/gu, '')      // Remove Unicode control/format chars
        .trim()
        .substring(0, 20000);                  // Limit to 20000 chars

      if (!pdfText) {
        throw new Error('PDF appears to be empty or unreadable.');
      }

      const response = await fetch('/api/generate-test-cases', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          apiKey: apiKey,
          systemPrompt: SYSTEM_PROMPT,
          pdfText: pdfText,
          model: 'claude-sonnet-4-20250514'
        })
      });

      const rawResponse = await response.text();
      let data = null;

      if (rawResponse) {
        try {
          data = JSON.parse(rawResponse);
        } catch {
          throw new Error(`Server returned non-JSON response (HTTP ${response.status}).`);
        }
      }

      if (!response.ok) {
        console.error('Full API Error:', data || rawResponse);
        throw new Error(data?.error || `Failed to generate test cases. Error: ${response.status}`);
      }

      if (!data || !data.content || !Array.isArray(data.content) || !data.content[0]?.text) {
        throw new Error('Invalid response payload from server.');
      }

      let assistantMessage = data.content[0].text;

      console.log('AI Response (first 500 chars):', assistantMessage.substring(0, 500));

      // If response is already clean JSON, use it directly
      let parsedCases;
      try {
        parsedCases = JSON.parse(assistantMessage);
        if (Array.isArray(parsedCases) && parsedCases.length > 0) {
          setTestCases(parsedCases);
        } else {
          throw new Error('Response is not a valid JSON array');
        }
      } catch (parseError) {
        console.error('Parse failed, trying additional cleanup:', parseError.message);

        // Additional cleanup if initial parse failed
        let cleanedMessage = assistantMessage
          .replace(/^```(json)?/gm, '')
          .replace(/```$/gm, '')
          .replace(/,\s*([\]}])/g, '$1')  // Remove trailing commas
          .trim();

        // Extract JSON array if wrapped in text
        const arrayMatch = cleanedMessage.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
          cleanedMessage = arrayMatch[0];
        }

        try {
          parsedCases = JSON.parse(cleanedMessage);
          if (Array.isArray(parsedCases) && parsedCases.length > 0) {
            setTestCases(parsedCases);
          } else {
            throw new Error('No valid JSON array found in response');
          }
        } catch (finalError) {
          console.error('All parsing attempts failed:', finalError);
          console.error('Raw response:', assistantMessage.substring(0, 1000));
          throw new Error(`Invalid JSON from AI: ${finalError.message}`);
        }
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
    const headers = ['Test ID', 'Category', 'Title', 'Endpoint', 'Expected Status', 'Preconditions', 'Request Payload', 'Expected Result', 'Steps'];
    const rows = testCases.map(tc => [
      tc.test_id || '',
      tc.category || '',
      `"${String(tc.title || '').replace(/"/g, '""')}"`,
      tc.endpoint || '',
      tc.expected_status || '',
      `"${String(tc.preconditions || '').replace(/"/g, '""')}"`,
      `"${(typeof tc.request_payload === 'string' ? tc.request_payload : JSON.stringify(tc.request_payload || {}, null, 2)).replace(/"/g, '""')}"`,
      `"${String(tc.expected_result || '').replace(/"/g, '""')}"`,
      `"${Array.isArray(tc.steps) ? tc.steps.join('\\n').replace(/"/g, '""') : ''}"`
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
                            {tc.expected_status && (
                              <div>
                                <div className="text-xs uppercase text-gray-500 mb-1">Expected Status</div>
                                <div className="text-gray-200 bg-black p-2 rounded-sm border border-gray-800">{tc.expected_status}</div>
                              </div>
                            )}
                            {tc.request_payload && (
                              <div>
                                <div className="text-xs uppercase text-gray-500 mb-1">Request Payload</div>
                                <pre className="text-gray-200 bg-black p-2 rounded-sm border border-gray-800 whitespace-pre-wrap break-words">{typeof tc.request_payload === 'string' ? tc.request_payload : JSON.stringify(tc.request_payload, null, 2)}</pre>
                              </div>
                            )}
                            <div>
                              <div className="text-xs uppercase text-gray-500 mb-1">Expected Result</div>
                              <div className="text-primary bg-primary/5 p-2 rounded-sm border border-primary/20">{tc.expected_result}</div>
                            </div></div>
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
                  Upload a backend technical design PDF and hit generate. The AI will extract 35-50 detailed API test cases tailored to your specifications.
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







