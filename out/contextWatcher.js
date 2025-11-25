"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContextWatcher = void 0;
exports.formatSummaryForBrain = formatSummaryForBrain;
class ContextWatcher {
    // Approximate token limits for different models
    static TOKEN_LIMITS = {
        'gpt-4': 8192,
        'gpt-4-turbo': 128000,
        'gpt-4o': 128000,
        'claude-3-opus': 200000,
        'claude-3-sonnet': 200000,
        'claude-3.5-sonnet': 200000,
        'claude-opus-4': 200000,
        'default': 100000 // Safe default
    };
    // Thresholds for summarization triggers
    static THRESHOLDS = {
        warningPercent: 60, // Start warning at 60%
        suggestPercent: 75, // Suggest summarize at 75%
        urgentPercent: 85, // Urgent summarize at 85%
        criticalPercent: 95 // Critical - may lose context
    };
    messageCount = 0;
    estimatedTokens = 0;
    modelLimit;
    lastSummaryAt = 0;
    conversationHistory = [];
    constructor(modelId) {
        this.modelLimit = this.getModelLimit(modelId);
    }
    /**
     * Get token limit for a model
     */
    getModelLimit(modelId) {
        if (!modelId)
            return ContextWatcher.TOKEN_LIMITS['default'];
        // Check for known model patterns
        for (const [pattern, limit] of Object.entries(ContextWatcher.TOKEN_LIMITS)) {
            if (modelId.toLowerCase().includes(pattern.toLowerCase())) {
                return limit;
            }
        }
        return ContextWatcher.TOKEN_LIMITS['default'];
    }
    /**
     * Estimate tokens from text (rough approximation: ~4 chars per token)
     */
    estimateTokens(text) {
        return Math.ceil(text.length / 4);
    }
    /**
     * Track a new message in the conversation
     */
    trackMessage(role, content) {
        this.messageCount++;
        const tokens = this.estimateTokens(content);
        this.estimatedTokens += tokens;
        this.conversationHistory.push({
            role,
            content,
            timestamp: new Date()
        });
        // Keep only last 100 messages in memory for summarization
        if (this.conversationHistory.length > 100) {
            this.conversationHistory = this.conversationHistory.slice(-100);
        }
    }
    /**
     * Get current context status
     */
    getStatus() {
        const percentFull = (this.estimatedTokens / this.modelLimit) * 100;
        let urgency;
        let shouldSummarize = false;
        if (percentFull >= ContextWatcher.THRESHOLDS.criticalPercent) {
            urgency = 'critical';
            shouldSummarize = true;
        }
        else if (percentFull >= ContextWatcher.THRESHOLDS.urgentPercent) {
            urgency = 'high';
            shouldSummarize = true;
        }
        else if (percentFull >= ContextWatcher.THRESHOLDS.suggestPercent) {
            urgency = 'medium';
            shouldSummarize = true;
        }
        else if (percentFull >= ContextWatcher.THRESHOLDS.warningPercent) {
            urgency = 'low';
            shouldSummarize = false;
        }
        else {
            urgency = 'low';
            shouldSummarize = false;
        }
        // Don't suggest summarize if we just did one
        if (this.messageCount - this.lastSummaryAt < 10) {
            shouldSummarize = false;
        }
        return {
            messageCount: this.messageCount,
            estimatedTokens: this.estimatedTokens,
            percentFull: Math.min(percentFull, 100),
            shouldSummarize,
            urgency
        };
    }
    /**
     * Generate a summary of the current conversation
     */
    async generateSummary(workspaceName, taskDescription) {
        // Extract key information from conversation history
        const filesModified = this.extractFilesModified();
        const keyDecisions = this.extractKeyDecisions();
        return {
            timestamp: new Date(),
            workspaceName,
            taskDescription,
            keyDecisions,
            filesModified,
            lessonsLearned: [], // To be filled by caller/LLM
            nextSteps: [], // To be filled by caller/LLM
            rawMessageCount: this.messageCount,
            estimatedTokens: this.estimatedTokens
        };
    }
    /**
     * Extract mentioned file paths from conversation
     */
    extractFilesModified() {
        const files = new Set();
        const filePatterns = [
            /`([^`]+\.[a-z]{2,4})`/gi, // `filename.ext`
            /(?:file|path)[:\s]+([^\s,]+\.[a-z]{2,4})/gi, // file: path.ext
            /(?:created|modified|edited|wrote)\s+([^\s,]+\.[a-z]{2,4})/gi
        ];
        for (const msg of this.conversationHistory) {
            if (msg.role === 'assistant') {
                for (const pattern of filePatterns) {
                    let match;
                    while ((match = pattern.exec(msg.content)) !== null) {
                        const file = match[1];
                        if (file && !file.includes('...') && file.length < 100) {
                            files.add(file);
                        }
                    }
                }
            }
        }
        return Array.from(files);
    }
    /**
     * Extract key decisions from conversation
     */
    extractKeyDecisions() {
        const decisions = [];
        const decisionPatterns = [
            /(?:decided|chose|selected|went with|using)\s+([^.!?\n]+)/gi,
            /(?:decision|choice):\s*([^.!?\n]+)/gi
        ];
        for (const msg of this.conversationHistory) {
            if (msg.role === 'assistant') {
                for (const pattern of decisionPatterns) {
                    let match;
                    while ((match = pattern.exec(msg.content)) !== null) {
                        const decision = match[1].trim();
                        if (decision.length > 10 && decision.length < 200) {
                            decisions.push(decision);
                        }
                    }
                }
            }
        }
        return decisions.slice(0, 10); // Max 10 decisions
    }
    /**
     * Mark that a summary was just created
     */
    markSummarized() {
        this.lastSummaryAt = this.messageCount;
    }
    /**
     * Reset for a new conversation
     */
    reset() {
        this.messageCount = 0;
        this.estimatedTokens = 0;
        this.lastSummaryAt = 0;
        this.conversationHistory = [];
    }
    /**
     * Get formatted status message for display
     */
    getStatusMessage() {
        const status = this.getStatus();
        const bar = this.getProgressBar(status.percentFull);
        let message = `Context: ${bar} ${status.percentFull.toFixed(0)}% (${status.messageCount} messages, ~${Math.round(status.estimatedTokens / 1000)}k tokens)`;
        if (status.urgency === 'critical') {
            message += '\n⚠️ CRITICAL: Context nearly full! Summarize NOW to avoid losing information.';
        }
        else if (status.urgency === 'high') {
            message += '\n🔴 Context getting full. Consider summarizing soon.';
        }
        else if (status.urgency === 'medium') {
            message += '\n🟡 Context moderately full. Good time to summarize.';
        }
        return message;
    }
    getProgressBar(percent) {
        const filled = Math.round(percent / 10);
        const empty = 10 - filled;
        return '█'.repeat(filled) + '░'.repeat(empty);
    }
}
exports.ContextWatcher = ContextWatcher;
/**
 * Format a conversation summary for saving to brain
 */
function formatSummaryForBrain(summary) {
    const date = summary.timestamp.toISOString().split('T')[0];
    let content = `## ${date} - ${summary.taskDescription}\n\n`;
    content += `**Workspace:** ${summary.workspaceName}\n`;
    content += `**Messages:** ${summary.rawMessageCount} (~${Math.round(summary.estimatedTokens / 1000)}k tokens)\n\n`;
    if (summary.keyDecisions.length > 0) {
        content += `### Key Decisions\n`;
        for (const decision of summary.keyDecisions) {
            content += `- ${decision}\n`;
        }
        content += '\n';
    }
    if (summary.filesModified.length > 0) {
        content += `### Files Modified\n`;
        for (const file of summary.filesModified) {
            content += `- \`${file}\`\n`;
        }
        content += '\n';
    }
    if (summary.lessonsLearned.length > 0) {
        content += `### Lessons Learned\n`;
        for (const lesson of summary.lessonsLearned) {
            content += `- ${lesson}\n`;
        }
        content += '\n';
    }
    if (summary.nextSteps.length > 0) {
        content += `### Next Steps\n`;
        for (const step of summary.nextSteps) {
            content += `- ${step}\n`;
        }
        content += '\n';
    }
    content += `---\n#auto-summarized #${summary.workspaceName.replace(/[^a-zA-Z0-9]/g, '-')}\n`;
    return content;
}
//# sourceMappingURL=contextWatcher.js.map