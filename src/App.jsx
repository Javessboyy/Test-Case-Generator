import React, { useState, useCallback, useMemo, useRef } from 'react';
import { Upload, FileText, Download, Copy, ChevronDown, ChevronUp, Loader2, CheckCircle, AlertCircle, Shield, Check } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';

// Import worker
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Set PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;
const getErrorMessage = (payload) => {
  if (!payload) return 'Unknown error';
  if (typeof payload === 'string') return payload;
  if (payload instanceof Error) return payload.message || 'Unknown error';

  if (typeof payload === 'object') {
    if (typeof payload.error === 'string') return payload.error;
    if (payload.error && typeof payload.error.message === 'string') return payload.error.message;
    if (typeof payload.message === 'string') return payload.message;
    if (typeof payload.details === 'string') return payload.details;

    try {
      return JSON.stringify(payload);
    } catch {
      return 'Unknown error';
    }
  }

  return String(payload);
};

const DEFAULT_MODEL = import.meta.env.VITE_OPENROUTER_MODEL || 'openai/gpt-5.2';

const SYSTEM_PROMPT = `You are a Senior Test engineer. Analyze the uploaded document and generate comprehensive test cases based on the requirements and features described.

Return the response as a JSON array of test cases with the following structure:
[
  {
    "title": "descriptive action with specific condition (e.g., login with valid credentials, register user with duplicate email, add product to cart with out of stock item)",
    "test_steps": [
      "Given user is on [page/screen] with [precondition/initial state]",
      "When user [performs action] on [element/component]",
      "And user has [additional precondition if applicable]",
      "And user [performs additional action if applicable]",
      "And [additional validation] should be verified",
      "And [data persistence or navigation result] should be confirmed",
      "Then [expected UI response/state change] should be displayed"
    ],
    "expected_result": "Expected UI behavior, visual state, and specific validation points (e.g., Success message 'Registration complete' is displayed, User is redirected to dashboard, Error message 'Invalid email format' appears below email field)",
    "priority": "Critical|High|Medium|Low",
    "behaviour": "Positive|Negative"
  }
]

Guidelines for test case generation:
1. Focus on UI testing scenarios with detailed Gherkin steps (Given/When/Then format)
2. Include comprehensive element state and visual feedback validation in Then steps
3. Create both positive scenarios (valid input, successful flows) and negative scenarios (invalid input, error states, edge cases)
4. Include boundary value testing for input fields, character limits, and data constraints
5. Specify exact user actions and expected UI responses in business language
6. Consider authentication and session scenarios (logged in, logged out, session expired)
7. Include form validation scenarios (required fields, format validation, field dependencies)
8. Add cross-browser and responsive design checks where applicable
9. Generate test cases for different user roles and permission levels
10. Include edge cases like empty states, loading states, special characters, rapid clicks

Important Instructions for Test Case Generation:
1. Cover ALL possible scenarios, edge cases, and variations
2. Include test cases for EVERY UI feature, page, and user flow described
3. Generate multiple variations for each scenario (valid, invalid, boundary cases)
4. Be exhaustive and detailed - quality AND quantity are both important
5. Think from Test Engineer perspective: "What could possibly go wrong or need testing?"

Test Case Coverage Checklist - Ensure you include:
1. Happy path scenarios (valid inputs, successful user journeys)
2. Error path scenarios (invalid inputs, error states)
3. Boundary value testing (min/max values, character limits)
4. UI state variations (loading, empty, error, success states)
5. Form validation scenarios (required fields, format validation)
6. Navigation and routing scenarios (page transitions, deep links)
7. Edge cases (empty data, special characters, extreme values)

Return ONLY a valid JSON array with NO markdown, NO backticks, NO explanation.`;

const CATEGORY_STYLES = {
  positive: 'text-primary border-primary',
  negative: 'text-negative border-negative'
};

const CATEGORY_ICONS = {
  positive: <CheckCircle size={16} className="text-primary" />,
  negative: <AlertCircle size={16} className="text-negative" />
};

export default function App() {
  const [file, setFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [testCases, setTestCases] = useState([]);
  const [filter, setFilter] = useState('All');
  const [expandedCards, setExpandedCards] = useState({});
  const [copied, setCopied] = useState(false);

  const fileInputRef = useRef(null);


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
          systemPrompt: SYSTEM_PROMPT,
          pdfText: pdfText,
          model: DEFAULT_MODEL
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
        throw new Error(getErrorMessage(data) || `Failed to generate test cases. Error: ${response.status}`);
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
      setError(`Error: ${getErrorMessage(err)}`);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredCases = useMemo(() => {
    if (filter === 'All') return testCases;
    return testCases.filter((tc) => {
      const behaviour = (tc.behaviour || tc.category || 'positive').toLowerCase();
      return behaviour === filter.toLowerCase();
    });
  }, [testCases, filter]);

  const categoryCounts = useMemo(() => {
    const counts = { All: testCases.length, Positive: 0, Negative: 0 };
    testCases.forEach((tc) => {
      const behaviour = (tc.behaviour || tc.category || 'positive').toLowerCase();
      if (behaviour === 'positive') counts.Positive++;
      if (behaviour === 'negative') counts.Negative++;
    });
    return counts;
  }, [testCases]);

  const toggleCard = (id) => {
    setExpandedCards((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const exportCSV = () => {
    if (testCases.length === 0) return;

    const csvEscape = (value) => {
      const text = String(value ?? '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n');
      return `"${text.replace(/"/g, '""')}"`;
    };

    const headers = ['Title', 'Behaviour', 'Priority', 'Test Type', 'Test Steps', 'Expected Result'];
    const rows = testCases.map((tc) => {
      const steps = Array.isArray(tc.test_steps) ? tc.test_steps : tc.steps;
      const stepsText = Array.isArray(steps)
        ? steps.map((step, index) => `${index + 1}. ${step}`).join('\n')
        : '';

      const expectedResultText = typeof tc.expected_result === 'string'
        ? tc.expected_result
        : JSON.stringify(tc.expected_result || {}, null, 2);

      return [
        csvEscape(tc.title || ''),
        csvEscape(tc.behaviour || tc.category || ''),
        csvEscape(tc.priority || ''),
        csvEscape(tc.test_type || ''),
        csvEscape(stepsText),
        csvEscape(expectedResultText)
      ];
    });

    const csvContent = [headers.map(csvEscape).join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'test_cases_excel.csv';
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
          <p className="text-gray-400">AI-powered UI test case generator for product documentation</p>
        </header>

        <section className="mb-8 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-1 flex flex-col gap-4">

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
              disabled={isLoading || !file}
              className={`w-full py-3 px-4 font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all ${isLoading || !file
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
                    {['All', 'Positive', 'Negative'].map(tab => (
                      <button
                        key={tab}
                        onClick={() => setFilter(tab)}
                        className={"px-3 py-1 text-xs uppercase tracking-wider transition-colors border " + (filter === tab
                          ? 'border-primary text-primary bg-primary/10'
                          : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-700'
                        )}
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
                  {filteredCases.map((tc, idx) => {
                    const rowId = tc.test_id || `TC-${String(idx + 1).padStart(3, '0')}`;
                    const isExpanded = expandedCards[rowId];
                    const catLower = (tc.behaviour || tc.category || 'positive').toLowerCase();
                    const colorClass = CATEGORY_STYLES[catLower] || CATEGORY_STYLES.positive;
                    const icon = CATEGORY_ICONS[catLower] || CATEGORY_ICONS.positive;

                    return (
                      <div key={rowId} className="border border-gray-800 bg-background overflow-hidden transition-all duration-200">
                        <div
                          className="p-3 flex items-start gap-3 cursor-pointer hover:bg-gray-900 transition-colors select-none"
                          onClick={() => toggleCard(rowId)}
                        >
                          <div className="pt-0.5 shrink-0">{icon}</div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className="font-bold text-gray-300">{rowId}</span>
                              <span className={"text-[10px] uppercase px-1.5 py-0.5 border " + colorClass + " bg-opacity-10 opacity-80"}>
                                {(tc.behaviour || tc.category || 'positive')}
                              </span>
                              {tc.priority && (
                                <span className="text-[10px] uppercase px-1.5 py-0.5 border border-gray-700 text-gray-300 bg-gray-900/50">
                                  {tc.priority}
                                </span>
                              )}
                              {tc.test_type && (
                                <span className="text-[10px] uppercase px-1.5 py-0.5 border border-gray-700 text-gray-400 bg-gray-900/50">
                                  {tc.test_type}
                                </span>
                              )}
                            </div>
                            <div className="text-gray-400 line-clamp-1">{tc.title}</div>
                          </div>
                          <div className="text-gray-500 shrink-0">
                            {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="p-4 border-t border-gray-800 bg-[#06080c] text-sm flex flex-col gap-4">
                            {tc.preconditions && tc.preconditions !== '-' && (
                              <div>
                                <div className="text-xs uppercase text-gray-500 mb-1">Preconditions</div>
                                <div className="text-gray-300 bg-black p-2 rounded-sm border border-gray-800">{tc.preconditions}</div>
                              </div>
                            )}
                            <div>
                              <div className="text-xs uppercase text-gray-500 mb-1">Test Steps</div>
                              <ol className="list-decimal list-inside text-gray-300 bg-black p-2 rounded-sm border border-gray-800 space-y-1">
                                {(Array.isArray(tc.test_steps) ? tc.test_steps : (tc.steps || [])).map((step, i) => <li key={i}>{step}</li>)}
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
                  Upload a UI/product requirements PDF and hit generate. The AI will extract detailed UI classic test cases tailored to your specifications.
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













