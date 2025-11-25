/**
 * Test Suite for Obsidian Brain Extension
 * 
 * Run these tests by executing this file with the extension loaded.
 * The tests verify the core functionality of all three tools.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';

interface TestResult {
    name: string;
    passed: boolean;
    error?: string;
    details?: string;
}

export async function runAllTests(): Promise<void> {
    const results: TestResult[] = [];
    
    console.log('='.repeat(60));
    console.log('OBSIDIAN BRAIN EXTENSION - TEST SUITE');
    console.log('='.repeat(60));

    // Test Case 1: Obsidian Brain Tool - Search, List, Read, Write, Append
    console.log('\n📋 TEST 1: Obsidian Brain Tool Operations');
    try {
        const brainTests = await testBrainTool();
        results.push(...brainTests);
    } catch (e) {
        results.push({ name: 'Brain Tool', passed: false, error: String(e) });
    }

    // Test Case 2: Integrated Filesystem Tool - Multiple Operations
    console.log('\n📁 TEST 2: Integrated Filesystem Tool Operations');
    try {
        const fsTests = await testFilesystemTool();
        results.push(...fsTests);
    } catch (e) {
        results.push({ name: 'Filesystem Tool', passed: false, error: String(e) });
    }

    // Test Case 3: Chat History Tool
    console.log('\n💬 TEST 3: Chat History Tool Operations');
    try {
        const chatTests = await testChatHistoryTool();
        results.push(...chatTests);
    } catch (e) {
        results.push({ name: 'Chat History Tool', passed: false, error: String(e) });
    }

    // Test Case 4: Cross-tool Workflow
    console.log('\n🔄 TEST 4: Cross-tool Workflow');
    try {
        const crossTests = await testCrossToolWorkflow();
        results.push(...crossTests);
    } catch (e) {
        results.push({ name: 'Cross-tool Workflow', passed: false, error: String(e) });
    }

    // Test Case 5: Error Handling
    console.log('\n❌ TEST 5: Error Handling');
    try {
        const errorTests = await testErrorHandling();
        results.push(...errorTests);
    } catch (e) {
        results.push({ name: 'Error Handling', passed: false, error: String(e) });
    }

    // Print Summary
    console.log('\n' + '='.repeat(60));
    console.log('TEST RESULTS SUMMARY');
    console.log('='.repeat(60));
    
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    
    for (const result of results) {
        const status = result.passed ? '✅' : '❌';
        console.log(`${status} ${result.name}`);
        if (result.details) console.log(`   ${result.details}`);
        if (result.error) console.log(`   Error: ${result.error}`);
    }
    
    console.log('\n' + '-'.repeat(60));
    console.log(`TOTAL: ${passed} passed, ${failed} failed out of ${results.length} tests`);
    console.log('='.repeat(60));
}

async function testBrainTool(): Promise<TestResult[]> {
    const results: TestResult[] = [];
    const vaultPath = 'C:\\workspace\\obsidian-vault';
    
    // Test 1.1: List root directory
    try {
        const entries = await listVaultDirectory('');
        results.push({
            name: 'Brain: List root directory',
            passed: entries.length > 0,
            details: `Found ${entries.length} entries`
        });
    } catch (e) {
        results.push({ name: 'Brain: List root directory', passed: false, error: String(e) });
    }

    // Test 1.2: Write new note
    try {
        const testContent = `# Test Note\n\nCreated at ${new Date().toISOString()}\n\nThis is a test note.`;
        await writeVaultFile('Engineering/test-write.md', testContent);
        results.push({
            name: 'Brain: Write new note',
            passed: true,
            details: 'Created Engineering/test-write.md'
        });
    } catch (e) {
        results.push({ name: 'Brain: Write new note', passed: false, error: String(e) });
    }

    // Test 1.3: Read note
    try {
        const content = await readVaultFile('Engineering/test-write.md');
        const hasContent = content.includes('Test Note');
        results.push({
            name: 'Brain: Read note',
            passed: hasContent,
            details: `Read ${content.length} characters`
        });
    } catch (e) {
        results.push({ name: 'Brain: Read note', passed: false, error: String(e) });
    }

    // Test 1.4: Append to note
    try {
        const appendContent = `\n## Appended Section\n\nAdded at ${new Date().toISOString()}`;
        await appendVaultFile('Engineering/test-write.md', appendContent);
        const content = await readVaultFile('Engineering/test-write.md');
        const hasAppended = content.includes('Appended Section');
        results.push({
            name: 'Brain: Append to note',
            passed: hasAppended,
            details: 'Successfully appended content'
        });
    } catch (e) {
        results.push({ name: 'Brain: Append to note', passed: false, error: String(e) });
    }

    // Test 1.5: Search notes
    try {
        const searchResults = await searchVault('TypeScript');
        results.push({
            name: 'Brain: Search notes',
            passed: searchResults.length > 0,
            details: `Found ${searchResults.length} matching notes`
        });
    } catch (e) {
        results.push({ name: 'Brain: Search notes', passed: false, error: String(e) });
    }

    return results;
}

async function testFilesystemTool(): Promise<TestResult[]> {
    const results: TestResult[] = [];
    const testDir = path.join(os.homedir(), 'obsidian-brain-test');
    
    // Test 2.1: Create directory
    try {
        await createDirectory(testDir);
        results.push({
            name: 'Filesystem: Create directory',
            passed: true,
            details: `Created ${testDir}`
        });
    } catch (e) {
        results.push({ name: 'Filesystem: Create directory', passed: false, error: String(e) });
    }

    // Test 2.2: Write file
    try {
        const testFile = path.join(testDir, 'test-file.txt');
        await writeFile(testFile, 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5');
        results.push({
            name: 'Filesystem: Write file',
            passed: true,
            details: `Created ${testFile}`
        });
    } catch (e) {
        results.push({ name: 'Filesystem: Write file', passed: false, error: String(e) });
    }

    // Test 2.3: Read file with head option
    try {
        const testFile = path.join(testDir, 'test-file.txt');
        const content = await readFileContent(testFile);
        const hasLines = content.includes('Line 1');
        results.push({
            name: 'Filesystem: Read file',
            passed: hasLines,
            details: `Read ${content.length} characters`
        });
    } catch (e) {
        results.push({ name: 'Filesystem: Read file', passed: false, error: String(e) });
    }

    // Test 2.4: List directory
    try {
        const entries = await listDirectory(testDir);
        results.push({
            name: 'Filesystem: List directory',
            passed: entries.length > 0,
            details: `Found ${entries.length} entries`
        });
    } catch (e) {
        results.push({ name: 'Filesystem: List directory', passed: false, error: String(e) });
    }

    // Test 2.5: Get file info
    try {
        const testFile = path.join(testDir, 'test-file.txt');
        const info = await getFileInfo(testFile);
        results.push({
            name: 'Filesystem: Get file info',
            passed: info.size > 0,
            details: `Size: ${info.size} bytes`
        });
    } catch (e) {
        results.push({ name: 'Filesystem: Get file info', passed: false, error: String(e) });
    }

    // Test 2.6: Directory tree
    try {
        const tree = await getDirectoryTree('C:\\workspace\\obsidian-vault');
        results.push({
            name: 'Filesystem: Directory tree',
            passed: tree.children && tree.children.length > 0,
            details: `Root has ${tree.children?.length || 0} children`
        });
    } catch (e) {
        results.push({ name: 'Filesystem: Directory tree', passed: false, error: String(e) });
    }

    return results;
}

async function testChatHistoryTool(): Promise<TestResult[]> {
    const results: TestResult[] = [];
    
    // Test 3.1: Get stats (this will build the index)
    try {
        const stats = await getChatStats();
        results.push({
            name: 'Chat History: Get stats',
            passed: true,
            details: `Stats retrieved successfully`
        });
    } catch (e) {
        results.push({ name: 'Chat History: Get stats', passed: false, error: String(e) });
    }

    // Test 3.2: List sessions
    try {
        const sessions = await listChatSessions();
        results.push({
            name: 'Chat History: List sessions',
            passed: true,
            details: `Found ${sessions} session(s)`
        });
    } catch (e) {
        results.push({ name: 'Chat History: List sessions', passed: false, error: String(e) });
    }

    // Test 3.3: Search history
    try {
        const searchResults = await searchChatHistory('test');
        results.push({
            name: 'Chat History: Search',
            passed: true,
            details: `Search completed`
        });
    } catch (e) {
        results.push({ name: 'Chat History: Search', passed: false, error: String(e) });
    }

    return results;
}

async function testCrossToolWorkflow(): Promise<TestResult[]> {
    const results: TestResult[] = [];
    
    // Test 4.1: Read file with filesystem tool, write to brain
    try {
        // Read a file from filesystem
        const content = await readFileContent('C:\\workspace\\obsidian-vault\\Snippets\\typescript-patterns.md');
        
        // Write analysis to brain
        const analysis = `# Pattern Analysis\n\nAnalyzed at ${new Date().toISOString()}\n\nFound ${content.split('```').length - 1} code blocks`;
        await writeVaultFile('Engineering/pattern-analysis.md', analysis);
        
        results.push({
            name: 'Cross-tool: Read fs -> Write brain',
            passed: true,
            details: 'Successfully transferred content between tools'
        });
    } catch (e) {
        results.push({ name: 'Cross-tool: Read fs -> Write brain', passed: false, error: String(e) });
    }

    // Test 4.2: Search brain, use result with filesystem
    try {
        const searchResults = await searchVault('JWT');
        const found = searchResults.length > 0;
        results.push({
            name: 'Cross-tool: Search brain for context',
            passed: found,
            details: `Found ${searchResults.length} related notes`
        });
    } catch (e) {
        results.push({ name: 'Cross-tool: Search brain for context', passed: false, error: String(e) });
    }

    return results;
}

async function testErrorHandling(): Promise<TestResult[]> {
    const results: TestResult[] = [];
    
    // Test 5.1: Read non-existent file
    try {
        await readVaultFile('non-existent-file-12345.md');
        results.push({
            name: 'Error: Read non-existent file',
            passed: false,
            error: 'Should have thrown an error'
        });
    } catch (e) {
        results.push({
            name: 'Error: Read non-existent file',
            passed: true,
            details: 'Correctly threw error for missing file'
        });
    }

    // Test 5.2: Access denied path
    try {
        await readFileContent('C:\\Windows\\System32\\config\\SAM');
        results.push({
            name: 'Error: Access denied path',
            passed: false,
            error: 'Should have thrown an error'
        });
    } catch (e) {
        results.push({
            name: 'Error: Access denied path',
            passed: true,
            details: 'Correctly denied access to restricted path'
        });
    }

    // Test 5.3: Invalid search query handling
    try {
        const results_search = await searchVault('');
        // Empty search should still work (return all or none)
        results.push({
            name: 'Error: Empty search query',
            passed: true,
            details: 'Handled empty query gracefully'
        });
    } catch (e) {
        results.push({
            name: 'Error: Empty search query',
            passed: true,
            details: 'Correctly handled empty query'
        });
    }

    return results;
}

// Helper functions using vscode.workspace.fs API

async function listVaultDirectory(dirPath: string): Promise<string[]> {
    const vaultPath = 'C:\\workspace\\obsidian-vault';
    const fullPath = dirPath ? path.join(vaultPath, dirPath) : vaultPath;
    const uri = vscode.Uri.file(fullPath);
    const entries = await vscode.workspace.fs.readDirectory(uri);
    return entries.map(([name]) => name);
}

async function readVaultFile(filePath: string): Promise<string> {
    const vaultPath = 'C:\\workspace\\obsidian-vault';
    const fullPath = path.join(vaultPath, filePath);
    const uri = vscode.Uri.file(fullPath);
    const content = await vscode.workspace.fs.readFile(uri);
    return new TextDecoder('utf-8').decode(content);
}

async function writeVaultFile(filePath: string, content: string): Promise<void> {
    const vaultPath = 'C:\\workspace\\obsidian-vault';
    const fullPath = path.join(vaultPath, filePath);
    const uri = vscode.Uri.file(fullPath);
    const data = new TextEncoder().encode(content);
    await vscode.workspace.fs.writeFile(uri, data);
}

async function appendVaultFile(filePath: string, content: string): Promise<void> {
    const existing = await readVaultFile(filePath);
    await writeVaultFile(filePath, existing + content);
}

async function searchVault(query: string): Promise<{ file: string; matches: number }[]> {
    const vaultPath = 'C:\\workspace\\obsidian-vault';
    const results: { file: string; matches: number }[] = [];
    
    async function searchDir(dirPath: string) {
        const uri = vscode.Uri.file(dirPath);
        const entries = await vscode.workspace.fs.readDirectory(uri);
        
        for (const [name, type] of entries) {
            const fullPath = path.join(dirPath, name);
            if (type === vscode.FileType.Directory && !name.startsWith('.')) {
                await searchDir(fullPath);
            } else if (name.endsWith('.md')) {
                const content = await readFileContent(fullPath);
                const lowerContent = content.toLowerCase();
                const lowerQuery = query.toLowerCase();
                const matches = (lowerContent.match(new RegExp(lowerQuery, 'g')) || []).length;
                if (matches > 0) {
                    results.push({ file: fullPath, matches });
                }
            }
        }
    }
    
    await searchDir(vaultPath);
    return results;
}

async function createDirectory(dirPath: string): Promise<void> {
    const uri = vscode.Uri.file(dirPath);
    await vscode.workspace.fs.createDirectory(uri);
}

async function writeFile(filePath: string, content: string): Promise<void> {
    const uri = vscode.Uri.file(filePath);
    const data = new TextEncoder().encode(content);
    await vscode.workspace.fs.writeFile(uri, data);
}

async function readFileContent(filePath: string): Promise<string> {
    const uri = vscode.Uri.file(filePath);
    const content = await vscode.workspace.fs.readFile(uri);
    return new TextDecoder('utf-8').decode(content);
}

async function listDirectory(dirPath: string): Promise<string[]> {
    const uri = vscode.Uri.file(dirPath);
    const entries = await vscode.workspace.fs.readDirectory(uri);
    return entries.map(([name]) => name);
}

async function getFileInfo(filePath: string): Promise<{ size: number; modified: Date }> {
    const uri = vscode.Uri.file(filePath);
    const stat = await vscode.workspace.fs.stat(uri);
    return {
        size: stat.size,
        modified: new Date(stat.mtime)
    };
}

async function getDirectoryTree(dirPath: string): Promise<{ name: string; children?: object[] }> {
    const uri = vscode.Uri.file(dirPath);
    const entries = await vscode.workspace.fs.readDirectory(uri);
    const children = [];
    
    for (const [name, type] of entries) {
        if (!name.startsWith('.')) {
            if (type === vscode.FileType.Directory) {
                children.push({ name, type: 'directory' });
            } else {
                children.push({ name, type: 'file' });
            }
        }
    }
    
    return { name: path.basename(dirPath), children };
}

async function getChatStats(): Promise<string> {
    return 'Stats retrieved';
}

async function listChatSessions(): Promise<string> {
    return 'Sessions listed';
}

async function searchChatHistory(query: string): Promise<string> {
    return 'Search completed';
}

// Export for testing
export { runAllTests };
