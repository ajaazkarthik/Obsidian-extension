/**
 * ContextWatcher monitors conversation length and provides auto-summarization triggers.
 *
 * This integrates with VS Code's Language Model API to track conversation state
 * and warn when context window is filling up.
 */
export interface ConversationSummary {
    timestamp: Date;
    workspaceName: string;
    taskDescription: string;
    keyDecisions: string[];
    filesModified: string[];
    lessonsLearned: string[];
    nextSteps: string[];
    rawMessageCount: number;
    estimatedTokens: number;
}
export interface ContextStatus {
    messageCount: number;
    estimatedTokens: number;
    percentFull: number;
    shouldSummarize: boolean;
    urgency: 'low' | 'medium' | 'high' | 'critical';
}
export declare class ContextWatcher {
    private static readonly TOKEN_LIMITS;
    private static readonly THRESHOLDS;
    private messageCount;
    private estimatedTokens;
    private modelLimit;
    private lastSummaryAt;
    private conversationHistory;
    constructor(modelId?: string);
    /**
     * Get token limit for a model
     */
    private getModelLimit;
    /**
     * Estimate tokens from text (rough approximation: ~4 chars per token)
     */
    private estimateTokens;
    /**
     * Track a new message in the conversation
     */
    trackMessage(role: 'user' | 'assistant' | 'system', content: string): void;
    /**
     * Get current context status
     */
    getStatus(): ContextStatus;
    /**
     * Generate a summary of the current conversation
     */
    generateSummary(workspaceName: string, taskDescription: string): Promise<ConversationSummary>;
    /**
     * Extract mentioned file paths from conversation
     */
    private extractFilesModified;
    /**
     * Extract key decisions from conversation
     */
    private extractKeyDecisions;
    /**
     * Mark that a summary was just created
     */
    markSummarized(): void;
    /**
     * Reset for a new conversation
     */
    reset(): void;
    /**
     * Get formatted status message for display
     */
    getStatusMessage(): string;
    private getProgressBar;
}
/**
 * Format a conversation summary for saving to brain
 */
export declare function formatSummaryForBrain(summary: ConversationSummary): string;
