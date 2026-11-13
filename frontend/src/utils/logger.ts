const formatLogMessage = (level: string, message: string, context?: string): string => {
  const timestamp = new Date().toISOString();
  const parts = [`[${timestamp}]`, `[${level}]`];

  if (context) {
    parts.push(`[${context}]`);
  }

  parts.push(message);
  return parts.join(' ');
};

export const logger = {
  debug: (message: string, context?: string, data?: unknown) => {
    if (import.meta.env.DEV) {
      console.debug(formatLogMessage('DEBUG', message, context), data);
    }
  },

  warn: (message: string, context?: string, data?: unknown) => {
    console.warn(formatLogMessage('WARN', message, context), data);
  },

  error: (message: string, context?: string, data?: unknown) => {
    console.error(formatLogMessage('ERROR', message, context), data);
  },
};
