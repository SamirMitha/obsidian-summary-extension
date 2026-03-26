import { App, Editor, MarkdownView, Plugin, PluginSettingTab, Setting, requestUrl, Notice } from 'obsidian';

interface LlmPluginSettings {
    provider: 'ollama' | 'openai';
    apiUrl: string;
    model: string;
    apiKey: string;
    showPointForm: boolean;
    showVerbose: boolean;
    showNeutral: boolean;
    showBestFit: boolean;
    showActionItems: boolean;
    showJira: boolean;
    showEmail: boolean;
    showTitleCommand: boolean;
}

const DEFAULT_SETTINGS: LlmPluginSettings = {
    provider: 'ollama',
    apiUrl: 'http://localhost:11434/api/generate',
    model: 'llama3.1',
    apiKey: '',
    showPointForm: true,
    showVerbose: true,
    showNeutral: true,
    showBestFit: true,
    showActionItems: true,
    showJira: true,
    showEmail: true,
    showTitleCommand: true
}

export default class ObsidianLlmPlugin extends Plugin {
    settings: LlmPluginSettings;

    async onload() {
        await this.loadSettings();

        // This adds a settings tab so the user can configure various aspects of the plugin
        this.addSettingTab(new LlmSettingTab(this.app, this));

        this.addCommand({
            id: 'generate-title-llm',
            name: 'Generate Title for Current Note',
            checkCallback: (checking: boolean) => {
                if (!this.settings.showTitleCommand) return false;
                const view = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (view && view.file) {
                    if (!checking) {
                        this.generateTitleForFile(view);
                    }
                    return true;
                }
                return false;
            }
        });

        this.registerEvent(
            this.app.workspace.on('editor-menu', (menu, editor, view) => {
                const selection = editor.getSelection();
                if (!selection || selection.trim().length === 0) return;

                if (this.settings.showPointForm) {
                    menu.addItem((item) => {
                        item
                            .setTitle('Format as Point Form (LLM)')
                            .setIcon('list')
                            .onClick(() => this.processSelection(editor, 'format_point_form', selection));
                    });
                }

                if (this.settings.showVerbose) {
                    menu.addItem((item) => {
                        item
                            .setTitle('Make Verbose / Organized (LLM)')
                            .setIcon('text')
                            .onClick(() => this.processSelection(editor, 'make_verbose', selection));
                    });
                }

                if (this.settings.showNeutral) {
                    menu.addItem((item) => {
                        item
                            .setTitle('Make Tone Neutral (LLM)')
                            .setIcon('check-in-circle')
                            .onClick(() => this.processSelection(editor, 'make_neutral', selection));
                    });
                }

                if (this.settings.showBestFit) {
                    menu.addItem((item) => {
                        item
                            .setTitle('Format to Best Fit (LLM)')
                            .setIcon('wand')
                            .onClick(() => this.processSelection(editor, 'format_best_fit', selection));
                    });
                }

                if (this.settings.showActionItems) {
                    menu.addItem((item) => {
                        item
                            .setTitle('Extract Action Items (LLM)')
                            .setIcon('check-square')
                            .onClick(() => this.processActionItems(editor, selection));
                    });
                }

                if (this.settings.showJira) {
                    menu.addItem((item) => {
                        item
                            .setTitle('Format as Jira Tickets (LLM)')
                            .setIcon('ticket')
                            .onClick(() => this.processSelection(editor, 'format_jira_tickets', selection));
                    });
                }

                if (this.settings.showEmail) {
                    menu.addItem((item) => {
                        item
                            .setTitle('Format as Professional Email (LLM)')
                            .setIcon('mail')
                            .onClick(() => this.processSelection(editor, 'format_email', selection));
                    });
                }
            })
        );
    }

    onunload() {

    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async processSelection(editor: Editor, action: string, selection: string) {
        const prompt = this.getPromptForAction(action, selection);

        new Notice("Calling LLM...");

        try {
            const result = await this.callLlm(prompt);
            editor.replaceSelection(result);
            new Notice("LLM generation complete.");
        } catch (error) {
            console.error("LLM Extension Error:", error);
            new Notice("LLM Error: " + (error instanceof Error ? error.message : String(error)));
        }
    }

    async processActionItems(editor: Editor, selection: string) {
        const prompt = this.getPromptForAction('extract_action_items', selection);

        new Notice("Extracting action items...");

        try {
            const result = await this.callLlm(prompt);
            const newText = selection + "\n\n### Action Items\n" + result;
            editor.replaceSelection(newText);
            new Notice("Action items extracted.");
        } catch (error) {
            console.error("LLM Extension Error:", error);
            new Notice("LLM Error: " + (error instanceof Error ? error.message : String(error)));
        }
    }

    async generateTitleForFile(view: MarkdownView) {
        if (!view.file || !view.file.parent) {
            new Notice("File is not fully loaded or saved.");
            return;
        }

        const text = view.getViewData();
        if (!text || text.trim().length === 0) {
            new Notice("Note is empty. Cannot generate title.");
            return;
        }

        new Notice("Generating title...");
        const prompt = this.getPromptForAction('generate_title', text);

        try {
            const result = await this.callLlm(prompt);

            let safeTitle = result.replace(/["*/:<>?\\|]/g, '').trim();
            safeTitle = safeTitle.replace(/^#+\s*/, '');
            if (safeTitle.length > 100) safeTitle = safeTitle.substring(0, 100);

            let folderPath = view.file.parent.path;
            folderPath = folderPath === '/' ? '' : folderPath + '/';
            const newPath = folderPath + safeTitle + '.' + view.file.extension;

            await this.app.fileManager.renameFile(view.file, newPath);
            new Notice("Title regenerated: " + safeTitle);
        } catch (error) {
            console.error("LLM Extension Error:", error);
            new Notice("LLM Error: " + (error instanceof Error ? error.message : String(error)));
        }
    }

    getPromptForAction(action: string, text: string): string {
        const context = "You are a personal note-taking assistant operating inside Obsidian. The following text comes from a user's personal vault. Maintain a personal, concise, and highly readable style appropriate for markdown notes. Output ONLY the final text, with absolutely no preamble, conversation, or explanation.";

        switch (action) {
            case 'format_point_form':
                return `${context}\n\nReformat the following text into clear, concise bullet points. Preserve the original meaning but make it easier to read at a glance.\n\nText to reformat:\n${text}`;
            case 'make_verbose':
                return `${context}\n\nExpand and deeply organize the following personal note. Structure it with clear headers and paragraphs to make it more comprehensive without losing the core context.\n\nText to expand:\n${text}`;
            case 'make_neutral':
                return `${context}\n\nRewrite the following note to have an entirely neutral, objective, and unbiased tone. Ground it as a factual reference.\n\nText to neutralize:\n${text}`;
            case 'format_best_fit':
                return `${context}\n\nAnalyze the following text and determine the single most appropriate Markdown format for personal notes. Use these strict rules:\n1. If it's a sequence of events, instructions, or steps -> Numbered List.\n2. If it contains commitments, action items, or tasks -> Task Checklist '- [ ]'.\n3. If it compares properties or lists structured data -> Markdown Table.\n4. If it covers multiple distinct subjects -> Group them with '###' Headers and Bullet points.\n5. If none of the above match -> well-structured paragraphs.\nPick exactly ONE dominant structure that fits best, and reformat the text into it.\n\nText to format:\n${text}`;
            case 'extract_action_items':
                return `${context}\n\nAnalyze the following text and extract all actionable items, tasks, or commitments. Output ONLY them as a clean Markdown checklist using '- [ ]'. Do not output anything else.\n\nText to analyze:\n${text}`;
            case 'format_jira_tickets':
                return `${context}\n\nAnalyze the following text (which contains action items or ideas) and convert them into structured Jira ticket payloads. For each distinct task, clearly provide a concise "Title:" and a brief "Description:". Do not invent false details, just map the raw notes to these two fields. Output ONLY the formatted tickets.\n\nText to format:\n${text}`;
            case 'format_email':
                return `${context}\n\nDraft a polite, professional, and clear corporate email based on the following rough notes. Include a concise "Subject: ", a friendly greeting, the body of the email perfectly structured, and a professional sign-off. Expand shorthand where necessary but do not invent false promises. Output ONLY the email.\n\nRaw Notes:\n${text}`;
            case 'generate_title':
                return `${context}\n\nRead the following note and generate a highly concise, descriptive file title for it. The title must be plain text with no quotes, no markdown headers, and under 80 characters. Output ONLY the title itself, with absolutely no preamble.\n\nNote content:\n${text}`;
            default:
                return text;
        }
    }

    async callLlm(prompt: string): Promise<string> {
        if (this.settings.provider === 'ollama') {
            const response = await requestUrl({
                url: this.settings.apiUrl,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: this.settings.model,
                    prompt: prompt,
                    stream: false
                })
            });

            if (response.status !== 200) {
                throw new Error(`API Error: ${response.status}`);
            }
            return response.json.response.trim();
        } else {
            // openai compatible
            const response = await requestUrl({
                url: this.settings.apiUrl, // e.g., https://api.openai.com/v1/chat/completions
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(this.settings.apiKey ? { 'Authorization': `Bearer ${this.settings.apiKey}` } : {})
                },
                body: JSON.stringify({
                    model: this.settings.model,
                    messages: [
                        { role: "user", content: prompt }
                    ]
                })
            });

            if (response.status !== 200) {
                throw new Error(`API Error: ${response.status}`);
            }
            return response.json.choices[0].message.content.trim();
        }
    }
}

class LlmSettingTab extends PluginSettingTab {
    plugin: ObsidianLlmPlugin;

    constructor(app: App, plugin: ObsidianLlmPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        containerEl.createEl('h2', { text: 'Settings for LLM Summary Extension' });

        new Setting(containerEl)
            .setName('LLM Provider')
            .setDesc('Select the API format to use')
            .addDropdown(dropDown => {
                dropDown.addOption('ollama', 'Ollama (Local)');
                dropDown.addOption('openai', 'OpenAI Compatible (Remote/Gateway)');
                dropDown.setValue(this.plugin.settings.provider);
                dropDown.onChange(async (value) => {
                    this.plugin.settings.provider = value as 'ollama' | 'openai';
                    if (value === 'ollama') {
                        this.plugin.settings.apiUrl = 'http://localhost:11434/api/generate';
                        this.plugin.settings.model = 'llama3.1';
                    } else {
                        this.plugin.settings.apiUrl = 'https://api.openai.com/v1/chat/completions';
                        this.plugin.settings.model = 'gpt-4o';
                    }
                    await this.plugin.saveSettings();
                    this.display(); // re-render to update the input fields
                });
            });

        new Setting(containerEl)
            .setName('API URL')
            .setDesc('The endpoint for the LLM.')
            .addText(text => text
                .setPlaceholder('Enter API URL')
                .setValue(this.plugin.settings.apiUrl)
                .onChange(async (value) => {
                    this.plugin.settings.apiUrl = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Model Name')
            .setDesc('The model to use (e.g., llama3.1, gpt-4o)')
            .addText(text => text
                .setPlaceholder('Enter model name')
                .setValue(this.plugin.settings.model)
                .onChange(async (value) => {
                    this.plugin.settings.model = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('API Key')
            .setDesc('Required for remote gateways (leave blank for typical local Ollama)')
            .addText(text => text
                .setPlaceholder('Enter your API Key')
                .setValue(this.plugin.settings.apiKey)
                .onChange(async (value) => {
                    this.plugin.settings.apiKey = value;
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl('h3', { text: 'Feature Toggles' });

        new Setting(containerEl)
            .setName('Show: Format as Point Form')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showPointForm)
                .onChange(async (value) => {
                    this.plugin.settings.showPointForm = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Show: Make Verbose / Organized')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showVerbose)
                .onChange(async (value) => {
                    this.plugin.settings.showVerbose = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Show: Make Tone Neutral')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showNeutral)
                .onChange(async (value) => {
                    this.plugin.settings.showNeutral = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Show: Format to Best Fit')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showBestFit)
                .onChange(async (value) => {
                    this.plugin.settings.showBestFit = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Show: Extract Action Items')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showActionItems)
                .onChange(async (value) => {
                    this.plugin.settings.showActionItems = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Show: Format as Jira Tickets')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showJira)
                .onChange(async (value) => {
                    this.plugin.settings.showJira = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Show: Format as Professional Email')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showEmail)
                .onChange(async (value) => {
                    this.plugin.settings.showEmail = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Enable Command: Generate Title for Current Note')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showTitleCommand)
                .onChange(async (value) => {
                    this.plugin.settings.showTitleCommand = value;
                    await this.plugin.saveSettings();
                }));
    }
}
