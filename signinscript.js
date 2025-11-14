// import { signInWithPopup, GoogleAuthProvider, getAuth } from "firebase/auth";
// import { initializeApp } from "firebase/app";
// import firebaseConfig from "./firebaseConfig.js";

// function signIn() {

//   const firebaseConfig = {
//     apiKey: "AIzaSyCfZazN6APqyG5W5QY7OtFpDfX_4jwiFdQ",
//     authDomain: "solveform-ai.firebaseapp.com",
//     projectId: "solveform-ai",
//     storageBucket: "solveform-ai.firebasestorage.app",
//     messagingSenderId: "631843265089",
//     appId: "1:631843265089:web:e9d1666a506800580b84c0",
//     measurementId: "G-1JR7175JTC",
//   };

//   const app = initializeApp(firebaseConfig);
//   const auth = getAuth();

//   // This code runs inside of an iframe in the extension's offscreen document.
//   // This gives you a reference to the parent frame, i.e. the offscreen document.
//   // You will need this to assign the targetOrigin for postMessage.
//   const PARENT_FRAME = document.location.ancestorOrigins[0];

//   // This demo uses the Google auth provider, but any supported provider works.
//   // Make sure that you enable any provider you want to use in the Firebase Console.
//   // https://console.firebase.google.com/project/_/authentication/providers
//   const PROVIDER = new GoogleAuthProvider();

//   function sendResponse(result) {
//     globalThis.parent.self.postMessage(JSON.stringify(result), PARENT_FRAME);
//   }

//   globalThis.addEventListener("message", function ({ data }) {
//     if (data.initAuth) {
//       // Opens the Google sign-in page in a popup, inside of an iframe in the
//       // extension's offscreen document.
//       // To centralize logic, all respones are forwarded to the parent frame,
//       // which goes on to forward them to the extension's service worker.
//       signInWithPopup(auth, PROVIDER).then(sendResponse).catch(sendResponse);
//     }
//   });
// }

// "content": """
const OFFSCREEN_DOCUMENT_PATH = "/offscreen.html";

// A global promise to avoid concurrency issues
let creatingOffscreenDocument;
let creating;

// Chrome only allows for a single offscreenDocument. This is a helper function
// that returns a boolean indicating if a document is already active.
async function hasDocument() {
  // Check all windows controlled by the service worker to see if one
  // of them is the offscreen document with the given path
  const matchedClients = await clients.matchAll();
  return matchedClients.some(
    (c) => c.url === chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)
  );
}

async function setupOffscreenDocument(path) {
  // If we do not have a document, we are already setup and can skip
  if (!(await hasDocument())) {
    // create offscreen document
    if (creating) {
      await creating;
    } else {
      creating = chrome.offscreen.createDocument({
        url: path,
        reasons: [chrome.offscreen.Reason.DOM_SCRAPING],
        justification: "authentication",
      });
      await creating;
      creating = null;
    }
  }
}

async function closeOffscreenDocument() {
  if (!(await hasDocument())) {
    return;
  }
  await chrome.offscreen.closeDocument();
}

function getAuth() {
  return new Promise(async (resolve, reject) => {
    const auth = await chrome.runtime.sendMessage({
      type: "firebase-auth",
      target: "offscreen",
    });
    auth?.name !== "FirebaseError" ? resolve(auth) : reject(auth);
  });
}

async function firebaseAuth() {
  // check in the db if user is already signed in
  // if user is signed in, return user
  // else sign in

  const user = await chrome.storage.local.get("user").then((data) => data.user);

  if (user) {
    console.log("User already signed in", user);
    return user;
  }

  await setupOffscreenDocument(OFFSCREEN_DOCUMENT_PATH);

  const auth = await getAuth()
    .then((auth) => {
      chrome.storage.local.set({ user: auth });
      console.log("SignInScript.js: User signed in", auth);
      return auth;
    })
    .catch((err) => {
      if (err.code === "auth/operation-not-allowed") {
        console.error(
          "You must enable an OAuth provider in the Firebase" +
            " console in order to use signInWithPopup. This sample" +
            " uses Google by default."
        );
      } else {
        console.error("signInScript.js: Error getting user", err);
        // return err;
      }
    })
    .finally(closeOffscreenDocument);

  return auth;
}

function signoutUser() {
  return new Promise(async (resolve, reject) => {
    const user = await chrome.runtime.sendMessage({
      type: "signoutUser",
      target: "offscreen",
    });
    user?.name !== "FirebaseError" ? resolve(user) : reject(user);
  });
}

async function signoutFirebaseUser() {
  await setupOffscreenDocument(OFFSCREEN_DOCUMENT_PATH);

  const user = await signoutUser()
    .then((user) => {
      console.log("SignInScript.js: User signed out", user);
      // Remove user from local storage
      console.log("Successfully signed out user");
      chrome.storage.local.remove("user");
      return user;
    })
    .catch((err) => {
      console.error("signInScript.js: Error signing out user", err);
      return err;
    })
    .finally(closeOffscreenDocument);

  return user;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "signIn") {
    firebaseAuth().then((user) => {
      sendResponse(user);
    });
    return true;
  } else if (message.action === "signoutUser") {
    console.log("Signing out user");
    signoutFirebaseUser().then((user) => {
      sendResponse(user);
    });
    chrome.storage.local.remove("user");
    return true;
  }
});

console.log("Sign in script loaded");
