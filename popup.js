console.log("[Popup] Script loaded");

// Provider selection handler
const providerSelect = document.getElementById("providerSelect");
const apiKeyLabel = document.getElementById("apiKeyLabel");

providerSelect.addEventListener("change", () => {
  const provider = providerSelect.value;
  console.log("[Popup] Provider changed to:", provider);
  
  if (provider === "openai") {
    apiKeyLabel.textContent = "OpenAI API Key:";
    document.getElementById("apiKeyInput").placeholder = "Enter your OpenAI API key (sk-...)";
  } else {
    apiKeyLabel.textContent = "Gemini API Key:";
    document.getElementById("apiKeyInput").placeholder = "Enter your Gemini API key";
  }
  
  // Load the appropriate API key
  loadApiKey(provider);
});

function loadApiKey(provider) {
  const keyName = provider === "openai" ? "openaiApiKey" : "geminiApiKey";
  chrome.storage.local.get([keyName, "selectedProvider"], (data) => {
    console.log(`[Popup] Checking for saved ${provider} API key`);
    if (data[keyName]) {
      console.log(`[Popup] ${provider} API Key found in storage`);
      document.getElementById("apiKeyInput").placeholder = "API Key saved (enter new to update)";
    } else {
      console.log(`[Popup] No ${provider} API key found in storage`);
      document.getElementById("apiKeyInput").placeholder = provider === "openai" 
        ? "Enter your OpenAI API key (sk-...)" 
        : "Enter your Gemini API key";
    }
  });
}

// API Key management
document.getElementById("saveApiKey").addEventListener("click", () => {
  console.log("[Popup] Save API Key button clicked");
  const provider = providerSelect.value;
  const apiKey = document.getElementById("apiKeyInput").value.trim();
  
  if (apiKey) {
    const keyName = provider === "openai" ? "openaiApiKey" : "geminiApiKey";
    const storageData = { [keyName]: apiKey, selectedProvider: provider };
    
    chrome.storage.local.set(storageData, () => {
      console.log(`[Popup] ${provider} API Key saved to storage`);
      notify(`${provider === "openai" ? "OpenAI" : "Gemini"} API Key saved successfully!`);
      document.getElementById("apiKeyInput").value = "";
      loadApiKey(provider);
    });
  } else {
    console.log("[Popup] Empty API key provided");
    notify("Please enter a valid API key");
  }
});

// Load saved provider and API key when popup opens
chrome.storage.local.get(["selectedProvider", "geminiApiKey", "openaiApiKey"], (data) => {
  console.log("[Popup] Loading saved settings");
  if (data.selectedProvider) {
    providerSelect.value = data.selectedProvider;
    providerSelect.dispatchEvent(new Event("change"));
  } else {
    loadApiKey("gemini");
  }
});

// JavaScript to handle the toggle switch
document.getElementById("toggleButton").addEventListener("change", function () {
  const slider = this.nextElementSibling;
  if (this.checked) {
    slider.style.backgroundColor = "#0078ff";
    slider.firstElementChild.style.transform = "translateX(22px)";
    chrome.storage.local.set({ showUI: true });
  } else {
    slider.style.backgroundColor = "#ccc";
    slider.firstElementChild.style.transform = "translateX(0)";
    chrome.storage.local.set({ showUI: false });
  }

  // Send a message to the content script
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const url = tabs[0].url;
    if (this.checked) {
      chrome.tabs.sendMessage(tabs[0].id, { action: "showUI" }, (response) => {
        console.log("Response from content script(showUI):", response);
      });
    } else {
      chrome.tabs.sendMessage(tabs[0].id, { action: "hideUI" }, (response) => {
        console.log("Response from content script(hideUI):", response);
      });
    }
  });
});

function notify(message) {
  const notification = document.getElementById("notification");
  notification.textContent = message;
  let notify = document.getElementById("notifier");
  notify.style.display = "block";
  setTimeout(() => {
    notify.style.display = "none";
  }, 3000);
}

buttonClicked = false;
// Add an event listener to the "run-script" button
document.getElementById("startButton").addEventListener("click", () => {
  console.log("[Popup] Solve Form button clicked");
  
  // check if the button is disabled
  if (document.getElementById("startButton").classList.contains("disabled")) {
    console.log("[Popup] Button is disabled");
    if (!buttonClicked) {
      notify("Please open a Google Form or Microsoft Form first.");
    }
    notify("Please wait for the current operation to complete.");
    return;
  }
  
  // Check API key first, then proceed
  const provider = providerSelect.value;
  const keyName = provider === "openai" ? "openaiApiKey" : "geminiApiKey";
  
  chrome.storage.local.get([keyName, "selectedProvider"], (data) => {
    console.log(`[Popup] Checking ${provider} API key from storage`);
    if (!data[keyName]) {
      console.log(`[Popup] No ${provider} API key found`);
      notify(`Please set your ${provider === "openai" ? "OpenAI" : "Gemini"} API key first!`);
      return;
    }
    console.log(`[Popup] ${provider} API key found, proceeding`);

    // Show loading indicator
    const loadingIndicator = document.getElementById("loadingIndicator");
    const statusText = document.getElementById("statusText");
    const startButton = document.getElementById("startButton");
    
    startButton.classList.add("disabled");
    startButton.textContent = "Solving...";
    loadingIndicator.style.display = "block";
    statusText.textContent = "Initializing...";

    // Send a message to the content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs[0].url;
      console.log("[Popup] Current tab URL:", url);
      
      if (url.includes("docs.google.com/forms")) {
        console.log("[Popup] Detected Google Form, sending message to content script");
        statusText.textContent = "Connecting to form...";
        
        // First, inject the content script if needed
        chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          files: ['front-backend.js']
        }).catch(() => {
          // Script might already be injected, that's okay
          console.log("[Popup] Script may already be injected");
        }).finally(() => {
          // Send message after ensuring script is loaded
          chrome.tabs.sendMessage(
            tabs[0].id,
            { action: "runScript-gform", provider: provider },
            (response) => {
            // Handle response or check for lastError
            if (chrome.runtime.lastError) {
              console.error("[Popup] Error sending message:", chrome.runtime.lastError.message);
              loadingIndicator.style.display = "none";
              startButton.classList.remove("disabled");
              startButton.textContent = "Solve Form";
              statusText.textContent = "✗ " + chrome.runtime.lastError.message;
              statusText.style.color = "#ea4335";
              notify("Error: " + chrome.runtime.lastError.message);
              setTimeout(() => {
                statusText.textContent = "";
              }, 5000);
              return;
            }
            
            console.log("[Popup] Response from content script:", response);
            
            loadingIndicator.style.display = "none";
            startButton.classList.remove("disabled");
            startButton.textContent = "Solve Form";
            
            if (response && response.status) {
              if (response.status === "Script executed") {
                statusText.textContent = "✓ Form solved successfully!";
                statusText.style.color = "#0F9D58";
              } else {
                statusText.textContent = "✗ " + response.status;
                statusText.style.color = "#ea4335";
                notify(response.status);
              }
            } else {
              statusText.textContent = "✗ No response from content script";
              statusText.style.color = "#ea4335";
              console.error("[Popup] No response received");
            }
            
            setTimeout(() => {
              statusText.textContent = "";
            }, 5000);
          }
          );
        });
      } else if (url.includes("forms.office.com")) {
        console.log("[Popup] Detected Microsoft Form, sending message to content script");
        statusText.textContent = "Connecting to form...";
        
        // First, inject the content script if needed
        chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          files: ['front-backend.js']
        }).catch(() => {
          // Script might already be injected, that's okay
          console.log("[Popup] Script may already be injected");
        }).finally(() => {
          // Send message after ensuring script is loaded
          chrome.tabs.sendMessage(
            tabs[0].id,
            { action: "runScript-msform", provider: provider },
            (response) => {
            // Handle response or check for lastError
            if (chrome.runtime.lastError) {
              console.error("[Popup] Error sending message:", chrome.runtime.lastError.message);
              loadingIndicator.style.display = "none";
              startButton.classList.remove("disabled");
              startButton.textContent = "Solve Form";
              statusText.textContent = "✗ " + chrome.runtime.lastError.message;
              statusText.style.color = "#ea4335";
              notify("Error: " + chrome.runtime.lastError.message);
              setTimeout(() => {
                statusText.textContent = "";
              }, 5000);
              return;
            }
            
            console.log("[Popup] Response from content script:", response);
            
            loadingIndicator.style.display = "none";
            startButton.classList.remove("disabled");
            startButton.textContent = "Solve Form";
            
            if (response && response.status) {
              if (response.status === "Script executed") {
                statusText.textContent = "✓ Form solved successfully!";
                statusText.style.color = "#0F9D58";
              } else {
                statusText.textContent = "✗ " + response.status;
                statusText.style.color = "#ea4335";
                notify(response.status);
              }
            } else {
              statusText.textContent = "✗ No response from content script";
              statusText.style.color = "#ea4335";
              console.error("[Popup] No response received");
            }
            
            setTimeout(() => {
              statusText.textContent = "";
            }, 5000);
          }
          );
        });
      } else {
        console.log("[Popup] Not a supported form URL");
        loadingIndicator.style.display = "none";
        startButton.classList.remove("disabled");
        startButton.textContent = "Solve Form";
        statusText.textContent = "Please open a Google Form first";
        statusText.style.color = "#ea4335";
      }
    });
  });
});

// Model selection removed - using Gemini only

// if current tab is forms.google.com -> manage the startButton
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const url = tabs[0].url;
  console.log("[Popup] Checking current tab on popup open:", url);
  if (
    url.includes("docs.google.com/forms") ||
    url.includes("forms.office.com")
  ) {
    console.log("[Popup] Form detected, enabling start button");
    // enable startButton
    document.getElementById("startButton").classList.remove("disabled");
  } else {
    console.log("[Popup] Not a form page, button remains disabled");
  }
});

// Removed Firebase auth - not needed for local extension

// check if user turned on or off show settings
chrome.storage.local.get("showUI", (data) => {
  if (data.showUI === undefined) {
    chrome.storage.local.set({ showUI: true });
  }
  var tb = document.getElementById("toggleButton");
  if (data.showUI === true && tb.checked === false) {
    document.getElementById("toggleButton").click();
  } else if (data.showUI === false && tb.checked === true) {
    document.getElementById("toggleButton").click();
  }
});

// Credits and payment functions removed - using direct API
