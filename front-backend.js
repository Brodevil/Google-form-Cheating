// Cache for working model (persists across calls)
let cachedWorkingModel = null;
let availableModels = null;

// Function to get available models from API
async function getAvailableModels(apiKey) {
  if (availableModels) {
    console.log("[Content] Using cached available models");
    return availableModels;
  }
  
  console.log("[Content] Fetching available models from API...");
  const versions = ["v1", "v1beta"];
  
  for (const version of versions) {
    try {
      const listUrl = `https://generativelanguage.googleapis.com/${version}/models?key=${apiKey}`;
      console.log(`[Content] Trying to list models from ${version}...`);
      
      const response = await fetch(listUrl);
      
      if (response.ok) {
        const data = await response.json();
        console.log(`[Content] Successfully fetched models from ${version}`);
        
        // Filter models that support generateContent
        const supportedModels = data.models
          .filter(model => 
            model.supportedGenerationMethods && 
            model.supportedGenerationMethods.includes("generateContent")
          )
          .map(model => ({
            name: model.name.split("/").pop(), // Extract just the model name
            version: version,
            fullName: model.name
          }));
        
        console.log(`[Content] Found ${supportedModels.length} supported models:`, supportedModels.map(m => m.name));
        availableModels = supportedModels;
        return supportedModels;
      }
    } catch (error) {
      console.warn(`[Content] Failed to list models from ${version}:`, error.message);
    }
  }
  
  // Fallback to common models if API listing fails
  console.warn("[Content] Could not fetch model list, using fallback models");
  return [
    { name: "gemini-1.5-flash", version: "v1" },
    { name: "gemini-1.5-pro", version: "v1" },
  ];
}

// Function to call Gemini API with automatic model detection
async function callGeminiAPI(apiKey, prompt, images = []) {
  console.log("[Content] Calling Gemini API...");
  console.log("[Content] Prompt length:", prompt.length);
  console.log("[Content] Images count:", images.length);
  
  // Helper function to try a single model
  const tryModel = async (modelConfig) => {
    const apiUrl = `https://generativelanguage.googleapis.com/${modelConfig.version}/models/${modelConfig.name}:generateContent?key=${apiKey}`;
    console.log(`[Content] Trying model: ${modelConfig.name} (${modelConfig.version})`);
    
    // Build parts array with text and images
    const parts = [{ text: prompt }];
    
    // Add images if available
    if (images && images.length > 0) {
      console.log("[Content] Processing images for Gemini API...");
      for (const img of images) {
        try {
          // Try to convert to base64 if it's a URL
          if (img.url) {
            const base64Data = await imageUrlToBase64(img.url);
            parts.push({
              inline_data: {
                mime_type: base64Data.mimeType || "image/jpeg",
                data: base64Data.data || base64Data.url
              }
            });
          } else if (img.mimeType && img.data) {
            // Already in base64 format
            parts.push({
              inline_data: {
                mime_type: img.mimeType,
                data: img.data
              }
            });
          }
        } catch (error) {
          console.warn("[Content] Failed to process image:", error.message);
        }
      }
    }
    
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: parts,
          },
        ],
      }),
    });

    console.log("[Content] API Response status:", response.status);

    if (!response.ok) {
      const errorData = await response.json();
      const errorMsg = errorData.error?.message || "API request failed";
      console.warn(`[Content] Model ${modelConfig.name} failed:`, errorMsg);
      return { success: false, error: errorMsg };
    }

    const data = await response.json();
    console.log(`[Content] Success with model: ${modelConfig.name}`);
    
    // Cache the working model for future calls
    if (!cachedWorkingModel || cachedWorkingModel.name !== modelConfig.name || cachedWorkingModel.version !== modelConfig.version) {
      cachedWorkingModel = modelConfig;
      console.log(`[Content] Cached working model: ${modelConfig.name} (${modelConfig.version})`);
    }
    
    console.log("[Content] API Success Response:", data);
    const answer = data.candidates[0].content.parts[0].text.trim();
    console.log("[Content] Extracted answer:", answer);
    return { success: true, answer };
  };
  
  // If we have a cached working model, try ONLY that first
  if (cachedWorkingModel) {
    console.log(`[Content] Using cached working model: ${cachedWorkingModel.name} (${cachedWorkingModel.version})`);
    const result = await tryModel(cachedWorkingModel);
    if (result.success) {
      return result.answer;
    }
    // Cached model failed, clear it and try others
    console.warn("[Content] Cached model failed, trying other models...");
    cachedWorkingModel = null;
  }
  
  // Get available models and try them
  const modelsToTry = await getAvailableModels(apiKey);
  console.log(`[Content] Will try ${modelsToTry.length} models`);
  
  let lastError = null;
  
  for (const modelConfig of modelsToTry) {
    const result = await tryModel(modelConfig);
    if (result.success) {
      return result.answer;
    }
    lastError = result.error;
  }
  
  // If all models failed, clear cache
  cachedWorkingModel = null;
  availableModels = null; // Clear model cache to retry discovery next time
  console.error("[Content] All models failed. Last error:", lastError);
  throw new Error(`All Gemini models failed. Last error: ${lastError}`);
}

// Cache for OpenAI working model
let cachedOpenAIModel = null;

// Function to get available OpenAI models
async function getAvailableOpenAIModels(apiKey) {
  console.log("[Content] Fetching available OpenAI models...");
  
  // Common OpenAI models to try (most capable first)
  const modelsToTry = [
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4-turbo",
    "gpt-4",
    "gpt-3.5-turbo",
    "gpt-3.5-turbo-16k",
  ];
  
  // Try to list models from API (may not work for all API keys)
  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
      },
    });
    
    if (response.ok) {
      const data = await response.json();
      const availableModels = data.data
        .filter(model => model.id.startsWith("gpt-"))
        .map(model => model.id)
        .sort();
      
      console.log("[Content] Found OpenAI models:", availableModels);
      // Prioritize models from API response
      return [...new Set([...availableModels, ...modelsToTry])];
    }
  } catch (error) {
    console.warn("[Content] Could not fetch OpenAI model list, using defaults:", error.message);
  }
  
  return modelsToTry;
}

// Function to call OpenAI API with automatic model detection
async function callOpenAIAPI(apiKey, prompt, images = []) {
  console.log("[Content] Calling OpenAI API...");
  console.log("[Content] Prompt length:", prompt.length);
  console.log("[Content] Images count:", images.length);
  
  // Helper function to try a single model
  const tryModel = async (modelName) => {
    const apiUrl = "https://api.openai.com/v1/chat/completions";
    console.log(`[Content] Trying OpenAI model: ${modelName}`);
    
    // Build content array with text and images
    const content = [{ type: "text", text: prompt }];
    
    // Add images if available (OpenAI supports base64 images)
    if (images && images.length > 0) {
      console.log("[Content] Processing images for OpenAI API...");
      for (const img of images) {
        try {
          let imageData;
          if (img.url) {
            const base64Data = await imageUrlToBase64(img.url);
            imageData = `data:${base64Data.mimeType || "image/jpeg"};base64,${base64Data.data || base64Data.url}`;
          } else if (img.mimeType && img.data) {
            imageData = `data:${img.mimeType};base64,${img.data}`;
          }
          
          if (imageData) {
            content.push({
              type: "image_url",
              image_url: {
                url: imageData
              }
            });
          }
        } catch (error) {
          console.warn("[Content] Failed to process image:", error.message);
        }
      }
    }
    
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          {
            role: "user",
            content: content,
          },
        ],
        temperature: 0.7,
      }),
    });

    console.log("[Content] OpenAI API Response status:", response.status);

    if (!response.ok) {
      const errorData = await response.json();
      const errorMsg = errorData.error?.message || "API request failed";
      console.warn(`[Content] OpenAI model ${modelName} failed:`, errorMsg);
      return { success: false, error: errorMsg };
    }

    const data = await response.json();
    console.log(`[Content] Success with OpenAI model: ${modelName}`);
    
    // Cache the working model for future calls
    if (!cachedOpenAIModel || cachedOpenAIModel !== modelName) {
      cachedOpenAIModel = modelName;
      console.log(`[Content] Cached working OpenAI model: ${modelName}`);
    }
    
    console.log("[Content] OpenAI API Success Response:", data);
    const answer = data.choices[0].message.content.trim();
    console.log("[Content] Extracted answer:", answer);
    return { success: true, answer };
  };
  
  // If we have a cached working model, try ONLY that first
  if (cachedOpenAIModel) {
    console.log(`[Content] Using cached working OpenAI model: ${cachedOpenAIModel}`);
    const result = await tryModel(cachedOpenAIModel);
    if (result.success) {
      return result.answer;
    }
    // Cached model failed, clear it and try others
    console.warn("[Content] Cached OpenAI model failed, trying other models...");
    cachedOpenAIModel = null;
  }
  
  // Get available models and try them
  const modelsToTry = await getAvailableOpenAIModels(apiKey);
  console.log(`[Content] Will try ${modelsToTry.length} OpenAI models`);
  
  let lastError = null;
  
  for (const modelName of modelsToTry) {
    const result = await tryModel(modelName);
    if (result.success) {
      return result.answer;
    }
    lastError = result.error;
  }
  
  // If all models failed, clear cache
  cachedOpenAIModel = null;
  console.error("[Content] All OpenAI models failed. Last error:", lastError);
  throw new Error(`All OpenAI models failed. Last error: ${lastError}`);
}

// Function to convert image URL to base64 (for CORS issues)
async function imageUrlToBase64(imageUrl) {
  try {
    console.log("[Content] Converting image URL to base64:", imageUrl.substring(0, 50));
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result.split(',')[1]; // Remove data:image/...;base64, prefix
        resolve({
          mimeType: blob.type || "image/jpeg",
          data: base64
        });
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.warn("[Content] Failed to convert image to base64, using URL:", error.message);
    return { url: imageUrl };
  }
}

// Unified API call function that routes to the correct provider
async function callAIAPI(provider, apiKey, prompt, images = []) {
  if (provider === "openai") {
    return await callOpenAIAPI(apiKey, prompt, images);
  } else {
    return await callGeminiAPI(apiKey, prompt, images);
  }
}

// Function to match answer to exact option
function matchExactOption(answer, options) {
  if (!options || options.length === 0) {
    return answer;
  }

  // Try exact match first
  const exactMatch = options.find(
    (opt) => opt.toLowerCase().trim() === answer.toLowerCase().trim()
  );
  if (exactMatch) {
    return exactMatch;
  }

  // Try partial match
  const partialMatch = options.find((opt) =>
    opt.toLowerCase().includes(answer.toLowerCase()) ||
    answer.toLowerCase().includes(opt.toLowerCase())
  );
  if (partialMatch) {
    return partialMatch;
  }

  // Return original answer if no match found
  return answer;
}

async function scrapeGoogleForm(provider = "gemini") {
  console.log("[Content] scrapeGoogleForm() called with provider:", provider);
  const formElements = [];

  // disable AI Solve button
  const solveButton = document.querySelector(".AI-Solve-Form-Button");
  if (solveButton) {
    solveButton.disabled = true;
    solveButton.textContent = "Solving...";
    console.log("[Content] Solve button disabled");
  } else {
    console.warn("[Content] Solve button not found!");
  }

  // Get both API keys from storage (we need both ChatGPT and Gemini)
  console.log("[Content] Getting both API keys from storage");
  const storageData = await new Promise((resolve) => {
    chrome.storage.local.get(["openaiApiKey", "geminiApiKey", "selectedProvider"], resolve);
  });

  const openaiApiKey = storageData.openaiApiKey;
  const geminiApiKey = storageData.geminiApiKey;

  if (!openaiApiKey || !geminiApiKey) {
    console.error(`[Content] Missing API keys - OpenAI: ${!!openaiApiKey}, Gemini: ${!!geminiApiKey}`);
    if (solveButton) {
      solveButton.disabled = false;
      solveButton.textContent = "AI Solve";
    }
    const missing = [];
    if (!openaiApiKey) missing.push("OpenAI");
    if (!geminiApiKey) missing.push("Gemini");
    return `Please set your ${missing.join(" and ")} API key(s) in the extension popup first!`;
  }
  console.log(`[Content] Both API keys found - OpenAI: ${openaiApiKey.length} chars, Gemini: ${geminiApiKey.length} chars`);

  // Get all form questions
  const questions = document.querySelectorAll(".Qr7Oae"); // Select all questions
  console.log("[Content] Found", questions.length, "questions");

  questions.forEach((question, index) => {
    const questionText = question.querySelector("span.M7eMe")
      ? question.querySelector("span.M7eMe").textContent.trim()
      : "No question text";
    
    console.log(`[Content] Question ${index + 1}:`, questionText.substring(0, 50) + "...");

    const questionData = {
      question: questionText,
      type: "", // Will be determined
      options: [],
      images: [], // Will store image URLs or base64
    };
    
    // Detect images in the question (Google Forms)
    const images = question.querySelectorAll("img");
    if (images.length > 0) {
      console.log(`[Content] Question ${index + 1} has ${images.length} image(s)`);
      for (const img of images) {
        const imgSrc = img.src || img.getAttribute("src");
        if (imgSrc && !imgSrc.includes("data:image/svg")) {
          questionData.images.push({ url: imgSrc });
          console.log(`[Content] Found image: ${imgSrc.substring(0, 50)}...`);
        }
      }
    }

    // Detect multiple choice (radio button) question
    if (question.querySelector("div.oyXaNc")) {
      questionData.type = "single_ans";
      const labels = question.querySelectorAll("label");
      const options = [];
      labels.forEach((label) => {
        const optionText = label.textContent.trim();
        // Check if option has an image
        const optionImg = label.querySelector("img");
        if (optionImg) {
          const imgSrc = optionImg.src || optionImg.getAttribute("src");
          if (imgSrc && !imgSrc.includes("data:image/svg")) {
            options.push({ text: optionText, image: { url: imgSrc } });
            console.log(`[Content] Option has image: ${imgSrc.substring(0, 50)}...`);
          } else {
            options.push(optionText);
          }
        } else {
          options.push(optionText);
        }
      });
      questionData.options = options;
      console.log(`[Content] Question ${index + 1} type: single_ans, options:`, options.map(o => typeof o === 'string' ? o : o.text));
    }

    // Detect multiple selection (checkbox) question
    else if (question.querySelector("div.Y6Myld")) {
      questionData.type = "multi_ans";
      const labels = question.querySelectorAll("label");
      const options = [];
      labels.forEach((label) => {
        const optionText = label.textContent.trim();
        // Check if option has an image
        const optionImg = label.querySelector("img");
        if (optionImg) {
          const imgSrc = optionImg.src || optionImg.getAttribute("src");
          if (imgSrc && !imgSrc.includes("data:image/svg")) {
            options.push({ text: optionText, image: { url: imgSrc } });
            console.log(`[Content] Option has image: ${imgSrc.substring(0, 50)}...`);
          } else {
            options.push(optionText);
          }
        } else {
          options.push(optionText);
        }
      });
      questionData.options = options;
      console.log(`[Content] Question ${index + 1} type: multi_ans, options:`, options.map(o => typeof o === 'string' ? o : o.text));
    }

    // Detect select dropdowns (Single Choice from dropdown)
    else if (question.querySelector("div.ry3kXd")) {
      questionData.type = "dropdown";
      var add = false;
      const options = [];
      const optionElements = question.querySelectorAll("span");
      for (let i = 0; i < optionElements.length; i++) {
        if (optionElements[i].textContent.trim() === "Choose") {
          add = true;
          continue;
        }
        if (!add) {
          continue;
        }
        const option = optionElements[i].textContent.trim();
        options.push(option);
      }
      questionData.options = options;
    }

    // Detect short answer questions (input[type="text"])
    else if (question.querySelector('input[type="text"]')) {
      questionData.type = "short_answer";
      console.log(`[Content] Question ${index + 1} type: short_answer`);
    }

    // Detect long answer questions (textarea)
    else if (question.querySelector("textarea")) {
      questionData.type = "long_answer";
      console.log(`[Content] Question ${index + 1} type: long_answer`);
    }

    // If the type is still undetermined, we can label it as 'unknown'
    if (!questionData.type) {
      questionData.type = "unknown";
      console.warn(`[Content] Question ${index + 1} type: unknown`);
    }

    // Push the question data to the result array
    formElements.push(questionData);
  });

  console.log("[Content] Total form elements collected:", formElements.length);

  try {
    // Process each question with Gemini API
    var drop_down_cntr = 0;
    for (let i = 0; i < formElements.length; i++) {
      console.log(`[Content] Processing question ${i + 1}/${formElements.length}`);
      const questionData = formElements[i];
      
      // Build prompt with options if available
      let prompt = `Answer the following question`;
      
      // Add image mention if images are present
      if (questionData.images && questionData.images.length > 0) {
        prompt += ` (${questionData.images.length} image(s) are included with this question)`;
      }
      
      if (questionData.options && questionData.options.length > 0) {
        prompt += ` by selecting from the given options. You MUST respond with the EXACT text of one or more options (comma-separated for multiple choice).\n\n`;
        prompt += `Question: ${questionData.question}\n\n`;
        prompt += `Options:\n`;
        
        // Collect images from options
        const optionImages = [];
        questionData.options.forEach((opt, idx) => {
          const optText = typeof opt === 'string' ? opt : opt.text;
          prompt += `${idx + 1}. ${optText}\n`;
          // If option has an image, add it to the images array
          if (typeof opt === 'object' && opt.image) {
            optionImages.push(opt.image);
          }
        });
        prompt += `\nRespond with ONLY the exact option text(s) from the list above.`;
        
        // Add option images to the images array
        if (optionImages.length > 0) {
          questionData.images = [...(questionData.images || []), ...optionImages];
          console.log(`[Content] Added ${optionImages.length} option image(s) to question ${i + 1}`);
        }
        
        console.log(`[Content] Question ${i + 1} prompt (with options${questionData.images?.length > 0 ? ' and images' : ''}):`, prompt.substring(0, 100) + "...");
      } else {
        prompt += `:\n\n${questionData.question}\n\nProvide a concise and accurate answer.`;
        console.log(`[Content] Question ${i + 1} prompt (text answer${questionData.images?.length > 0 ? ' with images' : ''}):`, prompt.substring(0, 100) + "...");
      }

      // Call both APIs simultaneously with images if available
      console.log(`[Content] Calling both ChatGPT and Gemini APIs for question ${i + 1}...`);
      const images = questionData.images || [];
      
      // Call both APIs in parallel
      const [gptAnswer, geminiAnswer] = await Promise.all([
        callAIAPI("openai", openaiApiKey, prompt, images).catch(err => {
          console.error(`[Content] OpenAI API error for question ${i + 1}:`, err);
          return null;
        }),
        callAIAPI("gemini", geminiApiKey, prompt, images).catch(err => {
          console.error(`[Content] Gemini API error for question ${i + 1}:`, err);
          return null;
        })
      ]);
      
      console.log(`[Content] Question ${i + 1} - GPT answer:`, gptAnswer);
      console.log(`[Content] Question ${i + 1} - Gemini answer:`, geminiAnswer);
      
      // Helper function to match answer to options
      const matchAnswerToOptions = (answer, isMulti) => {
        if (!answer || !questionData.options || questionData.options.length === 0) {
          return answer;
        }
        const optionTexts = questionData.options.map(opt => typeof opt === 'string' ? opt : opt.text);
        
        if (isMulti) {
          const answerParts = answer.split(",").map(a => a.trim());
          const matched = answerParts.map(part => matchExactOption(part, optionTexts)).filter(Boolean);
          return matched.map(matchedText => {
            const idx = optionTexts.indexOf(matchedText);
            return questionData.options[idx] || matchedText;
          });
        } else {
          const matchedText = matchExactOption(answer, optionTexts);
          const idx = optionTexts.indexOf(matchedText);
          const result = idx >= 0 ? (questionData.options[idx] || matchedText) : matchedText;
          if (typeof result === 'object' && result.text) {
            return result.text;
          }
          return result;
        }
      };
      
      // For MCQ questions: compare answers and determine what to mark/highlight
      let finalAnswer;
      let gptMatchedAnswer = null;
      let geminiMatchedAnswer = null;
      let answersMatch = false;
      
      if (questionData.options && questionData.options.length > 0) {
        // This is an MCQ question
        const isMulti = questionData.type === "multi_ans";
        
        gptMatchedAnswer = gptAnswer ? matchAnswerToOptions(gptAnswer, isMulti) : null;
        geminiMatchedAnswer = geminiAnswer ? matchAnswerToOptions(geminiAnswer, isMulti) : null;
        
        // Compare answers (normalize for comparison)
        const normalizeForComparison = (ans) => {
          if (!ans) return "";
          if (Array.isArray(ans)) {
            return ans.map(a => typeof a === 'string' ? a : (a.text || a)).sort().join(",");
          }
          return typeof ans === 'string' ? ans : (ans.text || ans);
        };
        
        const gptNormalized = normalizeForComparison(gptMatchedAnswer);
        const geminiNormalized = normalizeForComparison(geminiMatchedAnswer);
        answersMatch = gptNormalized.toLowerCase().trim() === geminiNormalized.toLowerCase().trim();
        
        if (answersMatch && gptMatchedAnswer) {
          // Both agree - use the answer (prefer Gemini for consistency)
          finalAnswer = geminiMatchedAnswer;
          console.log(`[Content] Question ${i + 1} - Both LLMs agree:`, finalAnswer);
        } else {
          // Different answers - mark both options (will be handled in form filling)
          finalAnswer = geminiMatchedAnswer || gptMatchedAnswer; // Use Gemini as default for display
          console.log(`[Content] Question ${i + 1} - LLMs disagree - GPT:`, gptMatchedAnswer, "Gemini:", geminiMatchedAnswer, "- Marking both");
        }
      } else {
        // Non-MCQ question - use Gemini's answer
        finalAnswer = geminiAnswer || gptAnswer;
        console.log(`[Content] Question ${i + 1} - Non-MCQ, using Gemini answer:`, finalAnswer);
      }

      // Fill in the form
      const response = finalAnswer;
      console.log(`[Content] Filling form for question ${i + 1}, type: ${questionData.type}`);

        // Handle single-choice and multiple-choice questions
        if (
          formElements[i].type === "multi_ans" ||
          formElements[i].type === "single_ans"
        ) {
          const options = formElements[i].options;
          // Extract text from options for comparison
          const optionTexts = options.map(opt => typeof opt === 'string' ? opt : opt.text);
          
          // Extract text from responses for comparison
          const getResponseTexts = (matchedAnswer) => {
            if (!matchedAnswer) return [];
            return Array.isArray(matchedAnswer) 
              ? matchedAnswer.map(r => typeof r === 'string' ? r : (r.text || r))
              : [typeof matchedAnswer === 'string' ? matchedAnswer : (matchedAnswer.text || matchedAnswer)];
          };
          
          const responseTexts = getResponseTexts(response);
          const gptResponseTexts = getResponseTexts(gptMatchedAnswer);
          const geminiResponseTexts = getResponseTexts(geminiMatchedAnswer);
          
          const questionLabels = questions[i].querySelectorAll("label");

          questionLabels.forEach((label, idx) => {
            const optionText = optionTexts[idx];
            const checked = label.querySelector("div[aria-checked=true]");
            const isGptAnswer = gptResponseTexts.includes(optionText);
            const isGeminiAnswer = geminiResponseTexts.includes(optionText);
            
            if (answersMatch && response) {
              // Both agree - mark the option normally
              if (responseTexts.includes(optionText)) {
                if (checked === null) {
                  label.click();
                }
              } else {
                if (checked !== null && !responseTexts.includes(optionText)) {
                  label.click();
                }
              }
            } else {
              // Different answers - mark both options (GPT's and Gemini's)
              if (isGptAnswer || isGeminiAnswer) {
                // Mark the option if either LLM selected it
                if (checked === null) {
                  label.click();
                }
              } else {
                // Not selected by either - uncheck if needed
                if (checked !== null) {
                  label.click();
                }
              }
            }
          });
        }
        // Handle dropdown questions
        else if (formElements[i].type === "dropdown") {
          if (response) {
            const qs = questions[i];
            const dropdown = qs.querySelector("div.ry3kXd");

            // Use a MutationObserver to wait for the dropdown options to appear
            const observer = new MutationObserver((mutationsList, observer) => {
              const options = qs.querySelectorAll('div[role="option"]');
              if (options.length > 0) {
                observer.disconnect(); // Stop observing once the options are loaded
                options.forEach((option) => {
                  if (option.textContent.trim() === response) {
                    option.click(); // Click the correct option
                  }
                });
              }
            });

            setTimeout(() => {
              dropdown.click(); // Open the dropdown
              // Observe changes to the dropdown's DOM
              observer.observe(qs, { childList: true, subtree: true });
            }, 500 * drop_down_cntr);
            drop_down_cntr += 1;
          }
        }

        // Handle short answer questions
        else if (formElements[i].type === "short_answer") {
          if (response) {
            const inputElement = questions[i].querySelector('input[type="text"]');
            const responseText = typeof response === 'string' ? response : (response.text || response);
            inputElement.focus();
            inputElement.value = responseText;
            inputElement.dispatchEvent(new Event("input", { bubbles: true }));
            inputElement.blur();
          }
        }
        // Handle long answer questions
        else if (formElements[i].type === "long_answer") {
          if (response) {
            const textareaElement = questions[i].querySelector("textarea");
            const responseText = typeof response === 'string' ? response : (response.text || response);
            textareaElement.focus();
            textareaElement.value = responseText;
            textareaElement.dispatchEvent(new Event("input", { bubbles: true }));
            textareaElement.blur();
          }
        }

      // Show answer on form if enabled
        const existingAnswer = questions[i].querySelector(
          ".AI-Form-Solver-Answer"
        );
        if (existingAnswer) {
          existingAnswer.remove();
        }
        const question = document.querySelectorAll(".M4DNQ")[i];
      if (question) {
        const answerElement = document.createElement("div");
        // Format response for display (handle both string and object formats)
        const formatAnswer = (ans) => {
          if (!ans) return "";
          if (Array.isArray(ans)) {
            return ans.map(r => typeof r === 'string' ? r : (r.text || r)).join(", ");
          } else if (typeof ans === 'object' && ans.text) {
            return ans.text;
          }
          return String(ans);
        };
        
        let displayResponse = response ? formatAnswer(response) : "";
        
        // For MCQ questions, show answer (even if LLMs differ, show what was marked)
        if (questionData.options && questionData.options.length > 0) {
          // Show the answer that was marked
          displayResponse = displayResponse;
        }
        
        if (displayResponse) {
          answerElement.innerHTML = displayResponse;
          answerElement.style.fontWeight = "bold";
          answerElement.style.color = "#333"; // Always use dark color, no green
          answerElement.className = "AI-Form-Solver-Answer";
          if (show_UI) {
            answerElement.style.display = "block";
          } else {
            answerElement.style.display = "none";
          }
          question.appendChild(answerElement);
        }
      }

      // Small delay between questions to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }

      // Enable AI Solve button
      document.querySelector(".AI-Solve-Form-Button").disabled = false;
      document.querySelector(".AI-Solve-Form-Button").textContent = "AI Solve";
    
    return "Script executed";
  } catch (error) {
    // Enable AI Solve button
    document.querySelector(".AI-Solve-Form-Button").disabled = false;
    document.querySelector(".AI-Solve-Form-Button").textContent = "AI Solve";
    return error.message;
  }
}

async function scrapeMSForm(provider = "gemini") {
  console.log("[Content] scrapeMSForm() called with provider:", provider);
  const formElements = [];

  // Disable AI Solve button
  const solveButton = document.querySelector(".AI-Solve-Form-Button");
  if (solveButton) {
    solveButton.disabled = true;
    solveButton.textContent = "Solving...";
  }

  // Get both API keys from storage (we need both ChatGPT and Gemini)
  console.log("[Content] Getting both API keys from storage for MS Form");
  const storageData = await new Promise((resolve) => {
    chrome.storage.local.get(["openaiApiKey", "geminiApiKey", "selectedProvider"], resolve);
  });

  const openaiApiKey = storageData.openaiApiKey;
  const geminiApiKey = storageData.geminiApiKey;

  if (!openaiApiKey || !geminiApiKey) {
    console.error(`[Content] Missing API keys - OpenAI: ${!!openaiApiKey}, Gemini: ${!!geminiApiKey}`);
    if (solveButton) {
      solveButton.disabled = false;
      solveButton.textContent = "AI Solve";
    }
    const missing = [];
    if (!openaiApiKey) missing.push("OpenAI");
    if (!geminiApiKey) missing.push("Gemini");
    return `Please set your ${missing.join(" and ")} API key(s) in the extension popup first!`;
  }
  console.log(`[Content] Both API keys found - OpenAI: ${openaiApiKey.length} chars, Gemini: ${geminiApiKey.length} chars`);

  // Get all form questions
  const questions = document.querySelectorAll(
    "div[data-automation-id=questionItem"
  ); // Select all question containers

  questions.forEach((question, index) => {
    const questionText = question.querySelector(
      "[data-automation-id='questionTitle']"
    )
      ? question
          .querySelector("[data-automation-id='questionTitle']")
          .textContent.trim()
      : "";

    const questionData = {
      question: questionText,
      type: "", // Will be determined
      options: [],
      images: [], // Will store image URLs or base64
    };
    
    // Detect images in the question (MS Forms)
    const images = question.querySelectorAll("img");
    if (images.length > 0) {
      console.log(`[Content] MS Form Question ${index + 1} has ${images.length} image(s)`);
      for (const img of images) {
        const imgSrc = img.src || img.getAttribute("src");
        if (imgSrc && !imgSrc.includes("data:image/svg")) {
          questionData.images.push({ url: imgSrc });
          console.log(`[Content] Found MS Form image: ${imgSrc.substring(0, 50)}...`);
        }
      }
    }

    // Detect single-choice (radio button) question
    if (question.querySelector('[data-automation-id="radio"]')) {
      questionData.type = "single_ans";
      const radioOptions = question.querySelectorAll('[data-automation-id="radio"]');
      const options = [];
      radioOptions.forEach((option) => {
        const optionText = option.getAttribute("data-automation-value").trim();
        // Check if option has an image
        const optionImg = option.closest('[data-automation-id="questionItem"]')?.querySelector("img");
        if (optionImg) {
          const imgSrc = optionImg.src || optionImg.getAttribute("src");
          if (imgSrc && !imgSrc.includes("data:image/svg")) {
            options.push({ text: optionText, image: { url: imgSrc } });
            console.log(`[Content] MS Form option has image: ${imgSrc.substring(0, 50)}...`);
          } else {
            options.push(optionText);
          }
        } else {
          options.push(optionText);
        }
      });
      questionData.options = options;
    }

    // Detect multiple-choice (checkbox) question
    else if (question.querySelector('[data-automation-id="checkbox"]')) {
      questionData.type = "multi_ans";
      const checkboxOptions = question.querySelectorAll('[data-automation-id="checkbox"]');
      const options = [];
      checkboxOptions.forEach((option) => {
        const optionText = option.getAttribute("data-automation-value").trim();
        // Check if option has an image
        const optionImg = option.closest('[data-automation-id="questionItem"]')?.querySelector("img");
        if (optionImg) {
          const imgSrc = optionImg.src || optionImg.getAttribute("src");
          if (imgSrc && !imgSrc.includes("data:image/svg")) {
            options.push({ text: optionText, image: { url: imgSrc } });
            console.log(`[Content] MS Form option has image: ${imgSrc.substring(0, 50)}...`);
          } else {
            options.push(optionText);
          }
        } else {
          options.push(optionText);
        }
      });
      questionData.options = options;
    }

    // Detect short-answer questions (input[type="text"])
    if (question.querySelector('input[aria-label="Single line text"]')) {
      questionData.type = "short_answer";
    }

    // Detect long-answer questions (textarea)
    else if (question.querySelector("textarea")) {
      questionData.type = "long_answer";
    }

    // If the type is still undetermined, label it as 'unknown'
    if (!questionData.type) {
      questionData.type = "unknown";
    }

    // Push the question data to the result array
    formElements.push(questionData);
  });

  try {
    // Process each question with Gemini API
    for (let i = 0; i < formElements.length; i++) {
      const questionData = formElements[i];
      
      // Build prompt with options if available
      let prompt = `Answer the following question`;
      
      // Add image mention if images are present
      if (questionData.images && questionData.images.length > 0) {
        prompt += ` (${questionData.images.length} image(s) are included with this question)`;
      }
      
      if (questionData.options && questionData.options.length > 0) {
        prompt += ` by selecting from the given options. You MUST respond with the EXACT text of one or more options (comma-separated for multiple choice).\n\n`;
        prompt += `Question: ${questionData.question}\n\n`;
        prompt += `Options:\n`;
        
        // Collect images from options
        const optionImages = [];
        questionData.options.forEach((opt, idx) => {
          const optText = typeof opt === 'string' ? opt : opt.text;
          prompt += `${idx + 1}. ${optText}\n`;
          // If option has an image, add it to the images array
          if (typeof opt === 'object' && opt.image) {
            optionImages.push(opt.image);
          }
        });
        prompt += `\nRespond with ONLY the exact option text(s) from the list above.`;
        
        // Add option images to the images array
        if (optionImages.length > 0) {
          questionData.images = [...(questionData.images || []), ...optionImages];
          console.log(`[Content] Added ${optionImages.length} option image(s) to MS Form question ${i + 1}`);
        }
        
        console.log(`[Content] MS Form Question ${i + 1} prompt (with options${questionData.images?.length > 0 ? ' and images' : ''}):`, prompt.substring(0, 100) + "...");
      } else {
        prompt += `:\n\n${questionData.question}\n\nProvide a concise and accurate answer.`;
        console.log(`[Content] MS Form Question ${i + 1} prompt (text answer${questionData.images?.length > 0 ? ' with images' : ''}):`, prompt.substring(0, 100) + "...");
      }

      // Call both APIs simultaneously with images if available
      console.log(`[Content] Calling both ChatGPT and Gemini APIs for MS Form question ${i + 1}...`);
      const images = questionData.images || [];
      
      // Call both APIs in parallel
      const [gptAnswer, geminiAnswer] = await Promise.all([
        callAIAPI("openai", openaiApiKey, prompt, images).catch(err => {
          console.error(`[Content] OpenAI API error for MS Form question ${i + 1}:`, err);
          return null;
        }),
        callAIAPI("gemini", geminiApiKey, prompt, images).catch(err => {
          console.error(`[Content] Gemini API error for MS Form question ${i + 1}:`, err);
          return null;
        })
      ]);
      
      console.log(`[Content] MS Form Question ${i + 1} - GPT answer:`, gptAnswer);
      console.log(`[Content] MS Form Question ${i + 1} - Gemini answer:`, geminiAnswer);
      
      // Helper function to match answer to options
      const matchAnswerToOptions = (answer, isMulti) => {
        if (!answer || !questionData.options || questionData.options.length === 0) {
          return answer;
        }
        const optionTexts = questionData.options.map(opt => typeof opt === 'string' ? opt : opt.text);
        
        if (isMulti) {
          const answerParts = answer.split(",").map(a => a.trim());
          const matched = answerParts.map(part => matchExactOption(part, optionTexts)).filter(Boolean);
          return matched.map(matchedText => {
            const idx = optionTexts.indexOf(matchedText);
            return questionData.options[idx] || matchedText;
          });
        } else {
          const matchedText = matchExactOption(answer, optionTexts);
          const idx = optionTexts.indexOf(matchedText);
          const result = idx >= 0 ? (questionData.options[idx] || matchedText) : matchedText;
          if (typeof result === 'object' && result.text) {
            return result.text;
          }
          return result;
        }
      };
      
      // For MCQ questions: compare answers and determine what to mark/highlight
      let finalAnswer;
      let gptMatchedAnswer = null;
      let geminiMatchedAnswer = null;
      let answersMatch = false;
      
      if (questionData.options && questionData.options.length > 0) {
        // This is an MCQ question
        const isMulti = questionData.type === "multi_ans";
        
        gptMatchedAnswer = gptAnswer ? matchAnswerToOptions(gptAnswer, isMulti) : null;
        geminiMatchedAnswer = geminiAnswer ? matchAnswerToOptions(geminiAnswer, isMulti) : null;
        
        // Compare answers (normalize for comparison)
        const normalizeForComparison = (ans) => {
          if (!ans) return "";
          if (Array.isArray(ans)) {
            return ans.map(a => typeof a === 'string' ? a : (a.text || a)).sort().join(",");
          }
          return typeof ans === 'string' ? ans : (ans.text || ans);
        };
        
        const gptNormalized = normalizeForComparison(gptMatchedAnswer);
        const geminiNormalized = normalizeForComparison(geminiMatchedAnswer);
        answersMatch = gptNormalized.toLowerCase().trim() === geminiNormalized.toLowerCase().trim();
        
        if (answersMatch && gptMatchedAnswer) {
          // Both agree - use the answer (prefer Gemini for consistency)
          finalAnswer = geminiMatchedAnswer;
          console.log(`[Content] MS Form Question ${i + 1} - Both LLMs agree:`, finalAnswer);
        } else {
          // Different answers - mark both options (will be handled in form filling)
          finalAnswer = geminiMatchedAnswer || gptMatchedAnswer; // Use Gemini as default for display
          console.log(`[Content] MS Form Question ${i + 1} - LLMs disagree - GPT:`, gptMatchedAnswer, "Gemini:", geminiMatchedAnswer, "- Marking both");
        }
      } else {
        // Non-MCQ question - use Gemini's answer
        finalAnswer = geminiAnswer || gptAnswer;
        console.log(`[Content] MS Form Question ${i + 1} - Non-MCQ, using Gemini answer:`, finalAnswer);
      }

      const response = finalAnswer;
      // Extract text from response for form filling
      const responseText = typeof response === 'string' ? response : (response.text || response);
      const responseTexts = Array.isArray(response) 
        ? response.map(r => typeof r === 'string' ? r : (r.text || r))
        : [responseText];

        // Handle single-choice questions
      if (questionData.type === "single_ans") {
        const options = questions[i].querySelectorAll(
            '[data-automation-id="radio"]'
          );
          let new_op = [];
          options.forEach((option) => {
            new_op.push(option.parentElement);
          });

          // Extract text from responses for comparison
          const getResponseTexts = (matchedAnswer) => {
            if (!matchedAnswer) return [];
            return Array.isArray(matchedAnswer) 
              ? matchedAnswer.map(r => typeof r === 'string' ? r : (r.text || r))
              : [typeof matchedAnswer === 'string' ? matchedAnswer : (matchedAnswer.text || matchedAnswer)];
          };
          
          const gptResponseTexts = getResponseTexts(gptMatchedAnswer);
          const geminiResponseTexts = getResponseTexts(geminiMatchedAnswer);
          const optionTexts = questionData.options.map(opt => typeof opt === 'string' ? opt : opt.text);

          // iterate on each child
        for (let j = 0; j < new_op.length; j++) {
            const optionText = optionTexts[j];
            const isGptAnswer = gptResponseTexts.some(rt => new_op[j].textContent.trim().includes(rt) || rt.includes(optionText));
            const isGeminiAnswer = geminiResponseTexts.some(rt => new_op[j].textContent.trim().includes(rt) || rt.includes(optionText));
            
            if (answersMatch && response) {
              // Both agree - mark normally
              if (new_op[j].textContent.trim().includes(responseText)) {
                new_op[j].click();
              }
            } else {
              // Different answers - mark both options (GPT's and Gemini's)
              if (isGptAnswer || isGeminiAnswer) {
                // Mark the option if either LLM selected it
                if (!new_op[j].querySelector("input").checked) {
                  new_op[j].click();
                }
              } else {
                // Not selected by either - uncheck if needed
                if (new_op[j].querySelector("input").checked) {
                  new_op[j].click();
                }
              }
            }
          }
        }

        // Handle multiple-choice questions
      else if (questionData.type === "multi_ans") {
        let options = questions[i].querySelectorAll(
            '[data-automation-id="checkbox"]'
          );
          let new_op = [];
          options.forEach((option) => {
            new_op.push(option.parentElement);
          });
          
          // Extract text from responses for comparison
          const getResponseTexts = (matchedAnswer) => {
            if (!matchedAnswer) return [];
            return Array.isArray(matchedAnswer) 
              ? matchedAnswer.map(r => typeof r === 'string' ? r : (r.text || r))
              : [typeof matchedAnswer === 'string' ? matchedAnswer : (matchedAnswer.text || matchedAnswer)];
          };
          
          const gptResponseTexts = getResponseTexts(gptMatchedAnswer);
          const geminiResponseTexts = getResponseTexts(geminiMatchedAnswer);
          const optionTexts = questionData.options.map(opt => typeof opt === 'string' ? opt : opt.text);
          
          if (answersMatch && response) {
            // Both agree - mark normally
            responseTexts.forEach((resp) => {
              new_op.forEach((option) => {
                let checked = option.querySelector("input").checked;
                if (option.textContent.trim() === resp) {
                  if (!checked) {
                    option.click();
                  }
                } else {
                  if (checked && !responseTexts.includes(option.textContent.trim())) {
                    option.click();
                  }
                }
              });
            });
          } else {
            // Different answers - mark both options (GPT's and Gemini's)
            new_op.forEach((option, idx) => {
              const optionText = optionTexts[idx];
              const isGptAnswer = gptResponseTexts.includes(optionText);
              const isGeminiAnswer = geminiResponseTexts.includes(optionText);
              let checked = option.querySelector("input").checked;
              
              if (isGptAnswer || isGeminiAnswer) {
                // Mark the option if either LLM selected it
                if (!checked) {
                  option.click();
                }
              } else {
                // Not selected by either - uncheck if needed
                if (checked) {
                  option.click();
                }
              }
            });
          }
        }

        // Handle short-answer questions
      else if (questionData.type === "short_answer") {
        if (response) {
          const input = questions[i].querySelector("input");
          const responseText = typeof response === 'string' ? response : (response.text || response);
          input.focus();
          input.value = responseText;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.blur();
        }
        }

        // Handle long-answer questions
      else if (questionData.type === "long_answer") {
        if (response) {
          const textarea = questions[i].querySelector("textarea");
          const responseText = typeof response === 'string' ? response : (response.text || response);
          textarea.focus();
          textarea.value = responseText;
          textarea.dispatchEvent(new Event("input", { bubbles: true }));
          textarea.blur();
        }
        }

      // Show answer on form if enabled
      const existingAnswer = questions[i].querySelector(
          ".AI-Form-Solver-Answer"
        );
        if (existingAnswer) {
          existingAnswer.remove();
        }
      const answerElement = document.createElement("div");
      // Format response for display (handle both string and object formats)
      const formatAnswer = (ans) => {
        if (!ans) return "";
        if (Array.isArray(ans)) {
          return ans.map(r => typeof r === 'string' ? r : (r.text || r)).join(", ");
        } else if (typeof ans === 'object' && ans.text) {
          return ans.text;
        }
        return String(ans);
      };
      
      let displayResponse = response ? formatAnswer(response) : "";
      
      // For MCQ questions, show answer (even if LLMs differ, show what was marked)
      if (questionData.options && questionData.options.length > 0) {
        // Show the answer that was marked
        displayResponse = displayResponse;
      }
      
      if (displayResponse) {
        answerElement.innerHTML = displayResponse;
        answerElement.style.fontWeight = "bold";
        answerElement.style.color = "#333"; // Always use dark color, no green
        answerElement.className = "AI-Form-Solver-Answer";
        if (show_UI) {
          answerElement.style.display = "block";
        } else {
          answerElement.style.display = "none";
        }
        questions[i].firstElementChild.appendChild(answerElement);
      }

      // Small delay between questions to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Enable AI Solve button
    document.querySelector(".AI-Solve-Form-Button").disabled = false;
    document.querySelector(".AI-Solve-Form-Button").textContent = "AI Solve";
    
    return "Script executed";
  } catch (error) {
      // Enable AI Solve button
      document.querySelector(".AI-Solve-Form-Button").disabled = false;
      document.querySelector(".AI-Solve-Form-Button").textContent = "AI Solve";
      return error.message;
  }
}

show_UI = true;

// wait for doc to load
function addmark(show_UI = true) {
  console.log("[Content] addmark() called, show_UI:", show_UI);
  try {
    var title = document.getElementById("FormTitleId_titleAriaId");
    if (title != null) {
      console.log("[Content] Microsoft Form detected");
      // Show AI solver button
      // make a button "AI Solve"
      var button = document.createElement("button");
      button.innerHTML = "AI Solve";
      button.style.padding = "10px 20px";
      button.style.backgroundColor = "#03787C"; // Google green color
      button.style.color = "#fff";
      button.style.border = "none";
      button.style.borderRadius = "5px";
      button.style.boxShadow = "0 4px 6px rgba(0, 0, 0, 0.1)";
      button.style.cursor = "pointer";
      button.style.fontSize = "16px";
      button.style.zIndex = "1000";
      button.style.transition = "background-color 0.3s, transform 0.3s";
      button.style.fontWeight = "bold";
      button.className = "AI-Solve-Form-Button";
      if (show_UI) {
        button.style.display = "block";
      } else {
        button.style.display = "none";
      }

      // Add hover effect
      button.addEventListener("mouseover", () => {
        button.style.backgroundColor = "#014446"; // Darker Google green color
      });
      button.addEventListener("mouseout", () => {
        button.style.backgroundColor = "#03787C"; // Back to normal color
      });
      button.addEventListener("click", () => {
        // console.log("AI Solve button clicked");
        scrapeMSForm();
      });

      title.appendChild(button);
      console.log("[Content] AI Solve button added to MS Form");
    } else {
      let title = document.querySelector(".ahS2Le");
      if (title) {
        console.log("[Content] Google Form detected");
      } else {
        console.warn("[Content] Form title not found, trying alternative selectors...");
      }

      // make a button "AI Solve"
      var button = document.createElement("button");
      button.innerHTML = "AI Solve";
      button.style.padding = "10px 20px";
      button.style.backgroundColor = "#000000"; // Google green color
      button.style.color = "#fff";
      button.style.border = "none";
      button.style.borderRadius = "5px";
      button.style.boxShadow = "0 4px 6px rgba(0, 0, 0, 0.1)";
      button.style.cursor = "pointer";
      button.style.fontSize = "16px";
      button.style.zIndex = "1000";
      button.style.transition = "background-color 0.3s, transform 0.3s";
      button.style.fontWeight = "bold";
      button.className = "AI-Solve-Form-Button";
      if (show_UI) {
        button.style.display = "block";
      } else {
        button.style.display = "none";
      }

      // Add hover effect
      button.addEventListener("mouseover", () => {
        button.style.backgroundColor = "#1d1d1d"; // Darker Google green color
      });
      button.addEventListener("mouseout", () => {
        button.style.backgroundColor = "#000000"; // Back to normal color
      });

      button.addEventListener("click", () => {
        // console.log("AI Solve button clicked");

        scrapeGoogleForm();
      });

      if (title) {
      title.appendChild(button);
        console.log("[Content] AI Solve button added to Google Form");
      } else {
        console.error("[Content] Could not find form title element to attach button");
      }
    }
  } catch (e) {
    console.error("[Content] Error in addmark():", e);
  }
}

// console.log("Form Scraper Content Script Loaded!");

function showUI() {
  show_UI = true;
  try {
    document.querySelector(".AI-Solve-Form-Button").style.display = "block";
  } catch (e) {}
  try {
    document.querySelectorAll(".AI-Form-Solver-Answer").forEach((element) => {
      element.style.display = "block";
    });
  } catch (e) {}
}

function hideUI() {
  show_UI = false;
  try {
    document.querySelector(".AI-Solve-Form-Button").style.display = "none";
  } catch (e) {}
  try {
    document.querySelectorAll(".AI-Form-Solver-Answer").forEach((element) => {
      element.style.display = "none";
    });
  } catch (e) {}
}

console.log("[Content] Content script loaded and ready");

try {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("[Content] Message received:", message);
    console.log("[Content] Message action:", message.action);
    
    // Handle async responses
    if (message.action === "runScript-gform") {
      console.log("[Content] Starting Google Form scraping...");
      const provider = message.provider || "gemini";
      
      // Use async/await pattern to ensure response is sent
      (async () => {
        try {
          const result = await scrapeGoogleForm(provider);
          console.log("[Content] Scraping completed, result:", result);
          sendResponse({ status: result || "Script executed" });
        } catch (error) {
          console.error("[Content] Error in scrapeGoogleForm:", error);
          sendResponse({ status: error.message || "Error occurred" });
        }
      })();
      
      return true; // Indicates we will send a response asynchronously
    } 
    else if (message.action === "runScript-msform") {
      console.log("[Content] Starting Microsoft Form scraping...");
      const provider = message.provider || "gemini";
      
      // Use async/await pattern to ensure response is sent
      (async () => {
        try {
          const result = await scrapeMSForm(provider);
          console.log("[Content] MS Form scraping completed, result:", result);
          sendResponse({ status: result || "Script executed" });
        } catch (error) {
          console.error("[Content] Error in scrapeMSForm:", error);
          sendResponse({ status: error.message || "Error occurred" });
        }
      })();
      
      return true; // Indicates we will send a response asynchronously
    } 
    else if (message.action === "showUI") {
      console.log("[Content] Showing UI");
      try {
      showUI();
      sendResponse({ status: "UI shown" });
      } catch (error) {
        console.error("[Content] Error showing UI:", error);
        sendResponse({ status: "Error showing UI" });
      }
      return true;
    } 
    else if (message.action === "hideUI") {
      console.log("[Content] Hiding UI");
      try {
      hideUI();
      sendResponse({ status: "UI hidden" });
      } catch (error) {
        console.error("[Content] Error hiding UI:", error);
        sendResponse({ status: "Error hiding UI" });
      }
      return true;
    } 
    else {
      console.log("[Content] Unknown action:", message.action);
      sendResponse({ status: "Unknown action" });
      return true;
    }
  });
} catch (e) {
  console.error("[Content] Error in message listener setup:", e);
}

// Removed user authentication - not needed for local extension

chrome.storage.local.get("showUI", (data) => {
  console.log("[Content] showUI setting:", data.showUI);
  if (data.showUI === undefined) {
    chrome.storage.local.set({ showUI: true });
    show_UI = true;
  } else if (data.showUI === true) {
    show_UI = true;
  } else {
    show_UI = false;
  }
  console.log("[Content] show_UI set to:", show_UI);
  addmark(show_UI);
});
