import React, { useState } from 'react';
import { Terminal, CheckCircle2, Copy } from 'lucide-react';

interface CommandRunnerProps {
  command: string;
  language?: string;
  os?: string;
}

export const CommandRunner: React.FC<CommandRunnerProps> = ({ command, language, os }) => {
  const [copied, setCopied] = useState(false);

  const cleanCommand = command.trim();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(cleanCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      // Fallback
      const textArea = document.createElement("textarea");
      textArea.value = cleanCommand;
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err2) {
        console.error("Fallback copy failed", err2);
      }
      document.body.removeChild(textArea);
    }
  };

  const isCommandLang = ['bash', 'sh', 'powershell', 'cmd', 'zsh'].includes(language?.toLowerCase() || '');

  if (!isCommandLang && cleanCommand.split('\n').length <= 1 && cleanCommand.length < 50 && !cleanCommand.includes('sudo') && !cleanCommand.includes('apt-') && !cleanCommand.includes('brew')) {
     return <code className="px-1.5 py-0.5 mx-0.5 inline-block bg-gray-100/80 border border-gray-200 rounded-md font-mono text-[0.9em] text-blue-700 break-words max-w-full">{cleanCommand}</code>;
  }

  return (
    <div className="my-3 border border-gray-200 rounded-xl overflow-hidden bg-gray-50 flex flex-col shadow-sm">
      <div className="flex items-center justify-between px-3 py-2 bg-gray-100 border-b border-gray-200">
        <div className="flex items-center gap-2">
           <Terminal className="w-4 h-4 text-gray-500" />
           <span className="text-xs font-semibold text-gray-700 uppercase tracking-wider">{language || 'Command'}</span>
        </div>
        <div className="flex gap-2">
            <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-2 py-1 bg-white hover:bg-gray-50 border border-gray-200 text-gray-600 rounded text-xs font-medium transition-colors"
            >
                {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied' : 'Copy'}
            </button>
        </div>
      </div>
      
      <div className="relative group bg-gray-900 overflow-x-auto">
        <pre className="p-3 text-sm font-mono text-gray-100 whitespace-pre-wrap">
          {cleanCommand}
        </pre>
      </div>
    </div>
  );
};
