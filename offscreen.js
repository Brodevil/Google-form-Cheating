// import {
//   getAuth,
//   signInWithPopup,
//   GoogleAuthProvider,
// } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";
// import { initializeApp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-app.js";
// import firebaseConfig from "./firebaseConfig.js";

// const app = initializeApp(firebaseConfig);
// const auth = getAuth(app);
// const provider = new GoogleAuthProvider();

// globalThis.addEventListener("message", async ({ data }) => {
//   if (data.initAuth) {
//     try {
//       const result = await signInWithPopup(auth, provider);
//       globalThis.parent.postMessage(JSON.stringify(result), "*");
//     } catch (error) {
//       globalThis.parent.postMessage(
//         JSON.stringify({ error: error.message }),
//         "*"
//       );
//     }
//   }
// });
// This URL must point to the public site
const _URL = "https://formsolver.vercel.app/login";
const iframe = document.createElement("iframe");
iframe.src = _URL;
document.documentElement.appendChild(iframe);
chrome.runtime.onMessage.addListener(handleChromeMessages);

function handleChromeMessages(message, sender, sendResponse) {
  // Extensions may have an number of other reasons to send messages, so you
  // should filter out any that are not meant for the offscreen document.
  if (message.target !== "offscreen") {
    return false;
  }

  if (message.type === "firebase-auth") {
    function handleIframeMessage({ data }) {
      try {
        if (data.startsWith("!_{")) {
          // Other parts of the Firebase library send messages using postMessage.
          // You don't care about them in this context, so return early.
          return;
        }
        data = JSON.parse(data);
        self.removeEventListener("message", handleIframeMessage);

        sendResponse(data);
      } catch (e) {
        console.log(`json parse failed - ${e.message}`);
      }
    }

    globalThis.addEventListener("message", handleIframeMessage, false);

    // Initialize the authentication flow in the iframed document. You must set the
    // second argument (targetOrigin) of the message in order for it to be successfully
    // delivered.
    console.log("Sending message to iframe to " + new URL(_URL).origin);
    iframe.contentWindow.postMessage({ initAuth: true }, new URL(_URL).origin);
    return true;
  }
  else if (message.type === "signoutUser") {
    function handleIframeMessage({ data }) {
      try {
        if (data.startsWith("!_{")) {
          // Other parts of the Firebase library send messages using postMessage.
          // You don't care about them in this context, so return early.
          return;
        }
        data = JSON.parse(data);
        self.removeEventListener("message", handleIframeMessage);

        sendResponse(data);
      } catch (e) {
        console.log(`json parse failed - ${e.message}`);
      }
    }

    globalThis.addEventListener("message", handleIframeMessage, false);

    // Initialize the authentication flow in the iframed document. You must set the
    // second argument (targetOrigin) of the message in order for it to be successfully
    // delivered.
    console.log("Sending message to iframe to " + new URL(_URL).origin);
    iframe.contentWindow.postMessage({ signoutUser: true }, new URL(_URL).origin);
    return true;
  }
}
