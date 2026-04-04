import { App, PluginSettingTab, Setting } from "obsidian";
import type TTSReaderPlugin from "./main";

export type TTSProvider = "elevenlabs" | "fishaudio" | "googletts" | "azuretts" | "webspeech";

export interface TTSSettings {
  ttsProvider: TTSProvider;
  webSpeechVoiceURI: string;
  elevenlabsApiKey: string;
  elevenlabsVoiceId: string;
  elevenlabsModel: "eleven_multilingual_v2" | "eleven_turbo_v2_5" | "eleven_flash_v2_5";
  fishAudioApiKey: string;
  fishAudioVoiceId: string;
  fishAudioModel: "s1" | "s2-pro";
  googleApiKey: string;
  googleVoiceName: string;
  googleLanguageCode: string;
  azureSubscriptionKey: string;
  azureRegion: string;
  azureVoiceName: string;
  defaultSpeed: number;
}

export const DEFAULT_SETTINGS: TTSSettings = {
  ttsProvider: "webspeech",
  webSpeechVoiceURI: "",
  elevenlabsApiKey: "",
  elevenlabsVoiceId: "21m00Tcm4TlvDq8ikWAM",
  elevenlabsModel: "eleven_multilingual_v2",
  fishAudioApiKey: "",
  fishAudioVoiceId: "",
  fishAudioModel: "s1",
  googleApiKey: "",
  googleVoiceName: "en-US-Neural2-A",
  googleLanguageCode: "en-US",
  azureSubscriptionKey: "",
  azureRegion: "eastus",
  azureVoiceName: "en-US-JennyNeural",
  defaultSpeed: 1.0,
};

// Built-in ElevenLabs voices
const ELEVENLABS_VOICES: Record<string, string> = {
  "21m00Tcm4TlvDq8ikWAM": "Rachel",
  "29vD33N1CtxCmqQRPOHJ": "Drew",
  "2EiwWnXFnvU5JabPnv8n": "Clyde",
  "5Q0t7uMcjvnagumLfvZi": "Paul",
  "AZnzlk1XvdvUeBnXmlld": "Domi",
  "EXAVITQu4vr4xnSDxMaL": "Bella",
  "ErXwobaYiN019PkySvjV": "Antoni",
  "MF3mGyEYCl7XYWbV9V6O": "Elli",
  "TxGEqnHWrfWFTfGW9XjX": "Josh",
  "VR6AewLTigWG4xSOukaG": "Arnold",
  "pNInz6obpgDQGcFmaJgB": "Adam",
  "yoZ06aMxZJJ28mfd3POQ": "Sam",
};

export class TTSSettingTab extends PluginSettingTab {
  plugin: TTSReaderPlugin;

  constructor(app: App, plugin: TTSReaderPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("TTS engine")
      .setDesc("Primary engine. Falls back to Web Speech on error.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("elevenlabs", "ElevenLabs")
          .addOption("fishaudio", "Fish Audio")
          .addOption("googletts", "Google Cloud TTS")
          .addOption("azuretts", "Azure AI Speech")
          .addOption("webspeech", "Web Speech (built-in)")
          .setValue(this.plugin.settings.ttsProvider)
          .onChange(async (value) => {
            this.plugin.settings.ttsProvider = value as TTSProvider;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (this.plugin.settings.ttsProvider === "elevenlabs") {
      containerEl.createEl("h3", { text: "ElevenLabs" });
      this.displayElevenLabsSettings(containerEl);
    }

    if (this.plugin.settings.ttsProvider === "fishaudio") {
      containerEl.createEl("h3", { text: "Fish Audio" });
      this.displayFishAudioSettings(containerEl);
    }

    if (this.plugin.settings.ttsProvider === "googletts") {
      containerEl.createEl("h3", { text: "Google Cloud TTS" });
      this.displayGoogleTTSSettings(containerEl);
    }

    if (this.plugin.settings.ttsProvider === "azuretts") {
      containerEl.createEl("h3", { text: "Azure AI Speech" });
      this.displayAzureTTSSettings(containerEl);
    }

    if (this.plugin.settings.ttsProvider === "webspeech") {
      containerEl.createEl("h3", { text: "Web Speech" });
      this.displayWebSpeechSettings(containerEl);
    }

    containerEl.createEl("h3", { text: "Web Speech (fallback)" });
    containerEl.createEl("p", {
      text: "Used as fallback when the primary engine fails.",
      cls: "setting-item-description",
    });
    if (this.plugin.settings.ttsProvider !== "webspeech") {
      this.displayWebSpeechSettings(containerEl);
    }

    containerEl.createEl("h3", { text: "General" });
    new Setting(containerEl)
      .setName("Default speed")
      .setDesc("Playback speed (0.5x - 2.0x).")
      .addSlider((slider) =>
        slider
          .setLimits(0.5, 2.0, 0.1)
          .setValue(this.plugin.settings.defaultSpeed)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.defaultSpeed = value;
            await this.plugin.saveSettings();
          })
      );
  }

  private displayWebSpeechSettings(containerEl: HTMLElement): void {
    const voiceSetting = new Setting(containerEl)
      .setName("Voice")
      .setDesc("Select a system voice.");

    const populateVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      voiceSetting.addDropdown((dropdown) => {
        dropdown.addOption("", "Default");
        for (const voice of voices) {
          dropdown.addOption(voice.voiceURI, `${voice.name} (${voice.lang})`);
        }
        dropdown
          .setValue(this.plugin.settings.webSpeechVoiceURI)
          .onChange(async (value) => {
            this.plugin.settings.webSpeechVoiceURI = value;
            await this.plugin.saveSettings();
          });
      });
    };

    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      populateVoices();
    } else {
      window.speechSynthesis.addEventListener("voiceschanged", () => {
        voiceSetting.controlEl.empty();
        populateVoices();
      }, { once: true });
      populateVoices();
    }
  }

  private displayElevenLabsSettings(containerEl: HTMLElement): void {
    const apiKeySetting = new Setting(containerEl)
      .setName("API key")
      .addText((text) => {
        text.inputEl.type = "password";
        text.inputEl.autocomplete = "off";
        text
          .setPlaceholder("xi-...")
          .setValue(this.plugin.settings.elevenlabsApiKey)
          .onChange(async (value) => {
            this.plugin.settings.elevenlabsApiKey = value;
            await this.plugin.saveSettings();
          });
      });
    const descEl = apiKeySetting.descEl;
    descEl.empty();
    descEl.appendText("Get your API key from ");
    descEl.createEl("a", {
      text: "ElevenLabs Developer Console",
      href: "https://elevenlabs.io/app/developers/api-keys",
    });
    descEl.appendText(".");

    new Setting(containerEl)
      .setName("Voice")
      .setDesc("ElevenLabs voice. Use a built-in voice or paste a custom voice ID.")
      .addDropdown((dropdown) => {
        for (const [id, name] of Object.entries(ELEVENLABS_VOICES)) {
          dropdown.addOption(id, name);
        }
        // If the current voice ID isn't in the built-in list, add it as "Custom"
        if (!ELEVENLABS_VOICES[this.plugin.settings.elevenlabsVoiceId]) {
          dropdown.addOption(this.plugin.settings.elevenlabsVoiceId, "Custom");
        }
        dropdown
          .setValue(this.plugin.settings.elevenlabsVoiceId)
          .onChange(async (value) => {
            this.plugin.settings.elevenlabsVoiceId = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Custom voice ID")
      .setDesc("Paste a voice ID to use a cloned or custom voice.")
      .addText((text) =>
        text
          .setPlaceholder("Voice ID")
          .setValue(
            ELEVENLABS_VOICES[this.plugin.settings.elevenlabsVoiceId]
              ? ""
              : this.plugin.settings.elevenlabsVoiceId
          )
          .onChange(async (value) => {
            if (value.trim()) {
              this.plugin.settings.elevenlabsVoiceId = value.trim();
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Model")
      .setDesc("multilingual_v2 is highest quality; flash_v2.5 is fastest.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("eleven_multilingual_v2", "Multilingual v2")
          .addOption("eleven_turbo_v2_5", "Turbo v2.5")
          .addOption("eleven_flash_v2_5", "Flash v2.5")
          .setValue(this.plugin.settings.elevenlabsModel)
          .onChange(async (value) => {
            this.plugin.settings.elevenlabsModel = value as TTSSettings["elevenlabsModel"];
            await this.plugin.saveSettings();
          })
      );
  }

  private displayAzureTTSSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Region")
      .setDesc("Must match your Speech resource's region.")
      .addDropdown((dropdown) => {
        const regions: Record<string, string> = {
          eastus: "East US",
          eastus2: "East US 2",
          westus: "West US",
          westus2: "West US 2",
          westus3: "West US 3",
          centralus: "Central US",
          northcentralus: "North Central US",
          southcentralus: "South Central US",
          westcentralus: "West Central US",
          canadacentral: "Canada Central",
          canadaeast: "Canada East",
          brazilsouth: "Brazil South",
          northeurope: "North Europe",
          westeurope: "West Europe",
          uksouth: "UK South",
          ukwest: "UK West",
          francecentral: "France Central",
          germanywestcentral: "Germany West Central",
          norwayeast: "Norway East",
          swedencentral: "Sweden Central",
          switzerlandnorth: "Switzerland North",
          switzerlandwest: "Switzerland West",
          italynorth: "Italy North",
          eastasia: "East Asia",
          southeastasia: "Southeast Asia",
          japaneast: "Japan East",
          japanwest: "Japan West",
          koreacentral: "Korea Central",
          centralindia: "Central India",
          australiaeast: "Australia East",
          uaenorth: "UAE North",
          qatarcentral: "Qatar Central",
          southafricanorth: "South Africa North",
        };
        for (const [id, name] of Object.entries(regions)) {
          dropdown.addOption(id, name);
        }
        dropdown
          .setValue(this.plugin.settings.azureRegion)
          .onChange(async (value) => {
            this.plugin.settings.azureRegion = value;
            await this.plugin.saveSettings();
          });
      });

    const apiKeySetting = new Setting(containerEl)
      .setName("Subscription key")
      .addText((text) => {
        text.inputEl.type = "password";
        text.inputEl.autocomplete = "off";
        text
          .setPlaceholder("Your Speech resource key")
          .setValue(this.plugin.settings.azureSubscriptionKey)
          .onChange(async (value) => {
            this.plugin.settings.azureSubscriptionKey = value;
            await this.plugin.saveSettings();
          });
      });
    const descEl = apiKeySetting.descEl;
    descEl.empty();
    descEl.appendText("Get your key from the ");
    descEl.createEl("a", {
      text: "Azure Portal",
      href: "https://portal.azure.com/#view/Microsoft_Azure_ProjectOxford/CognitiveServicesHub/~/SpeechServices",
    });
    descEl.appendText(".");

    const azureVoices: Record<string, string> = {
      "en-US-JennyNeural": "Jenny (Female)",
      "en-US-AriaNeural": "Aria (Female)",
      "en-US-GuyNeural": "Guy (Male)",
      "en-US-ChristopherNeural": "Christopher (Male)",
      "en-US-AmberNeural": "Amber (Female)",
      "en-US-AnaNeural": "Ana (Female, Child)",
      "en-US-DavisNeural": "Davis (Male)",
      "en-US-TonyNeural": "Tony (Male)",
      "en-GB-SoniaNeural": "Sonia (Female, UK)",
      "en-GB-RyanNeural": "Ryan (Male, UK)",
    };

    new Setting(containerEl)
      .setName("Voice")
      .addDropdown((dropdown) => {
        for (const [id, name] of Object.entries(azureVoices)) {
          dropdown.addOption(id, name);
        }
        if (!azureVoices[this.plugin.settings.azureVoiceName]) {
          dropdown.addOption(this.plugin.settings.azureVoiceName, "Custom");
        }
        dropdown
          .setValue(this.plugin.settings.azureVoiceName)
          .onChange(async (value) => {
            this.plugin.settings.azureVoiceName = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Custom voice name")
      .setDesc("Enter a voice name for other languages (e.g. fr-FR-DeniseNeural).")
      .addText((text) =>
        text
          .setPlaceholder("e.g. ja-JP-NanamiNeural")
          .setValue("")
          .onChange(async (value) => {
            if (value.trim()) {
              this.plugin.settings.azureVoiceName = value.trim();
              await this.plugin.saveSettings();
            }
          })
      );
  }

  private displayGoogleTTSSettings(containerEl: HTMLElement): void {
    const apiKeySetting = new Setting(containerEl)
      .setName("API key")
      .addText((text) => {
        text.inputEl.type = "password";
        text.inputEl.autocomplete = "off";
        text
          .setPlaceholder("AIza...")
          .setValue(this.plugin.settings.googleApiKey)
          .onChange(async (value) => {
            this.plugin.settings.googleApiKey = value;
            await this.plugin.saveSettings();
          });
      });
    const descEl = apiKeySetting.descEl;
    descEl.empty();
    descEl.appendText("Get your API key from the ");
    descEl.createEl("a", {
      text: "Google Cloud Console",
      href: "https://console.cloud.google.com/apis/credentials",
    });
    descEl.appendText(". Enable the Cloud Text-to-Speech API first.");

    new Setting(containerEl)
      .setName("Language")
      .setDesc("BCP-47 language code.")
      .addText((text) =>
        text
          .setPlaceholder("en-US")
          .setValue(this.plugin.settings.googleLanguageCode)
          .onChange(async (value) => {
            this.plugin.settings.googleLanguageCode = value.trim() || "en-US";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Voice")
      .setDesc("Voice name (e.g. en-US-Neural2-A, en-US-Wavenet-D, en-US-Journey-F).")
      .addDropdown((dropdown) => {
        const voices: Record<string, string> = {
          "en-US-Neural2-A": "Neural2-A (Male)",
          "en-US-Neural2-C": "Neural2-C (Female)",
          "en-US-Neural2-D": "Neural2-D (Male)",
          "en-US-Neural2-F": "Neural2-F (Female)",
          "en-US-Neural2-J": "Neural2-J (Male)",
          "en-US-Wavenet-A": "Wavenet-A (Male)",
          "en-US-Wavenet-C": "Wavenet-C (Female)",
          "en-US-Wavenet-D": "Wavenet-D (Male)",
          "en-US-Wavenet-F": "Wavenet-F (Female)",
        };
        for (const [id, name] of Object.entries(voices)) {
          dropdown.addOption(id, name);
        }
        if (!voices[this.plugin.settings.googleVoiceName]) {
          dropdown.addOption(this.plugin.settings.googleVoiceName, "Custom");
        }
        dropdown
          .setValue(this.plugin.settings.googleVoiceName)
          .onChange(async (value) => {
            this.plugin.settings.googleVoiceName = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Custom voice name")
      .setDesc("Enter a voice name for other languages or voice types.")
      .addText((text) =>
        text
          .setPlaceholder("e.g. fr-FR-Neural2-A")
          .setValue("")
          .onChange(async (value) => {
            if (value.trim()) {
              this.plugin.settings.googleVoiceName = value.trim();
              await this.plugin.saveSettings();
            }
          })
      );
  }

  private displayFishAudioSettings(containerEl: HTMLElement): void {
    const apiKeySetting = new Setting(containerEl)
      .setName("API key")
      .addText((text) => {
        text.inputEl.type = "password";
        text.inputEl.autocomplete = "off";
        text
          .setPlaceholder("sk-...")
          .setValue(this.plugin.settings.fishAudioApiKey)
          .onChange(async (value) => {
            this.plugin.settings.fishAudioApiKey = value;
            await this.plugin.saveSettings();
          });
      });
    const descEl = apiKeySetting.descEl;
    descEl.empty();
    descEl.appendText("Get your API key from ");
    descEl.createEl("a", {
      text: "Fish Audio Dashboard",
      href: "https://fish.audio/dashboard",
    });
    descEl.appendText(".");

    new Setting(containerEl)
      .setName("Voice ID")
      .setDesc("Paste a voice model ID from fish.audio. Leave empty for the default voice.")
      .addText((text) =>
        text
          .setPlaceholder("e.g. 8ef4a238714b45718ce04243307c57a7")
          .setValue(this.plugin.settings.fishAudioVoiceId)
          .onChange(async (value) => {
            this.plugin.settings.fishAudioVoiceId = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Model")
      .setDesc("s1 is the latest and most advanced.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("s1", "S1 (recommended)")
          .addOption("s2-pro", "S2 Pro")
          .setValue(this.plugin.settings.fishAudioModel)
          .onChange(async (value) => {
            this.plugin.settings.fishAudioModel = value as TTSSettings["fishAudioModel"];
            await this.plugin.saveSettings();
          })
      );
  }
}
