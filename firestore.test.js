const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require("@firebase/rules-unit-testing");
const { test, before, after, beforeEach } = require("node:test");
const fs = require("node:fs");

let testEnv;
const PROJECT_ID = process.env.GCP_PROJECT || "demo-no-project";
const ALICE_UID = "alice_123";
const BOB_UID = "bob_456";

const [emulatorHost, emulatorPortStr] = (process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8085").split(":");
const emulatorPort = parseInt(emulatorPortStr, 10);

function serverTs() {
  return new Date();
}

function validSettings(uid) {
  return {
    userId: uid,
    dailyNewLimit: 20,
    dailyNewDate: "2026-11-13",
    dailyNewCount: 0,
    dailyNewExtraBonus: 0,
    reviewsSinceLastBackup: 0,
    reminderEnabled: false,
    reminderTime: "20:00",
    darkThemeMode: "system",
    seededInitialCards: true,
    createdAt: serverTs(),
    updatedAt: serverTs(),
  };
}

function validCard(uid) {
  return {
    userId: uid,
    front: "سیستم لایتنر چیست؟",
    back: "تکرار فاصله‌دار با ۵ خانه",
    chapter: "فصل ۱: اصول سیستم لایتنر",
    lesson: "درس ۱: مبانی",
    box: 1,
    newCard: true,
    lapses: 0,
    starred: false,
    nextReviewMillis: 1700000000000,
    createdAt: serverTs(),
    updatedAt: serverTs(),
  };
}

function validReport(uid) {
  return {
    userId: uid,
    monthKey: "1405_08",
    monthLabel: "آبان ۱۴۰۵",
    savedDate: "2026-11-13",
    overallMastery: 45,
    totalCards: 10,
    chapters: [{ chapter: "فصل ۱", total: 10, mastered: 2, masteryPercent: 45 }],
    createdAt: serverTs(),
    updatedAt: serverTs(),
  };
}

before(async () => {
  const rules = fs.readFileSync("./firestore.rules", "utf8");
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules,
      host: emulatorHost,
      port: emulatorPort,
    },
  });
});

after(async () => {
  if (testEnv) {
    await testEnv.cleanup();
  }
});

beforeEach(async () => {
  if (testEnv) {
    await testEnv.clearFirestore();
  }
});

test("Unauthenticated user cannot read or write flashcards or settings", async () => {
  const unauthDb = testEnv.unauthenticatedContext().firestore();
  await assertFails(unauthDb.collection("users").doc(ALICE_UID).get());
  await assertFails(unauthDb.collection("users").doc(ALICE_UID).collection("flashcards").get());
  await assertFails(unauthDb.collection("users").doc(ALICE_UID).collection("flashcards").doc("c1").set(validCard(ALICE_UID)));
});

test("Owner can create, list, update, and delete own flashcards", async () => {
  const aliceDb = testEnv.authenticatedContext(ALICE_UID).firestore();
  const cardRef = aliceDb.collection("users").doc(ALICE_UID).collection("flashcards").doc("card_1");
  await assertSucceeds(cardRef.set(validCard(ALICE_UID)));
  await assertSucceeds(aliceDb.collection("users").doc(ALICE_UID).collection("flashcards").get());
  await assertSucceeds(cardRef.update({ box: 2, newCard: false, updatedAt: serverTs() }));
  await assertSucceeds(cardRef.delete());
});

test("Owner can create and update user settings and monthly reports", async () => {
  const aliceDb = testEnv.authenticatedContext(ALICE_UID).firestore();
  const userRef = aliceDb.collection("users").doc(ALICE_UID);
  await assertSucceeds(userRef.set(validSettings(ALICE_UID)));
  await assertSucceeds(userRef.update({ dailyNewLimit: 30, updatedAt: serverTs() }));

  const reportRef = userRef.collection("monthlyReports").doc("1405_08");
  await assertSucceeds(reportRef.set(validReport(ALICE_UID)));
  await assertSucceeds(reportRef.update({ overallMastery: 60, updatedAt: serverTs() }));
});

test("Cross-user access is denied for settings, flashcards, and reports", async () => {
  const aliceDb = testEnv.authenticatedContext(ALICE_UID).firestore();
  await assertSucceeds(aliceDb.collection("users").doc(ALICE_UID).set(validSettings(ALICE_UID)));
  await assertSucceeds(aliceDb.collection("users").doc(ALICE_UID).collection("flashcards").doc("card_1").set(validCard(ALICE_UID)));

  const bobDb = testEnv.authenticatedContext(BOB_UID).firestore();
  await assertFails(bobDb.collection("users").doc(ALICE_UID).get());
  await assertFails(bobDb.collection("users").doc(ALICE_UID).collection("flashcards").get());
  await assertFails(bobDb.collection("users").doc(ALICE_UID).collection("flashcards").doc("card_1").update({ starred: true, updatedAt: serverTs() }));
  await assertFails(bobDb.collection("users").doc(ALICE_UID).collection("flashcards").doc("card_1").delete());
});

test("Dirty Dozen: ghost fields, invalid box, and immutable userId/createdAt fail", async () => {
  const aliceDb = testEnv.authenticatedContext(ALICE_UID).firestore();
  const cardsCol = aliceDb.collection("users").doc(ALICE_UID).collection("flashcards");

  // Ghost field rejected on create
  await assertFails(cardsCol.doc("card_ghost").set({ ...validCard(ALICE_UID), isAdmin: true }));

  // Invalid box rejected
  await assertFails(cardsCol.doc("card_bad_box").set({ ...validCard(ALICE_UID), box: 6 }));

  // Valid create then invalid updates
  await assertSucceeds(cardsCol.doc("card_ok").set(validCard(ALICE_UID)));
  await assertFails(cardsCol.doc("card_ok").update({ userId: BOB_UID, updatedAt: serverTs() }));
  await assertFails(cardsCol.doc("card_ok").update({ box: 0, updatedAt: serverTs() }));
  await assertFails(cardsCol.doc("card_ok").update({ ghostField: "x", updatedAt: serverTs() }));
});
