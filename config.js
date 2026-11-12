// Settings of the web and Microsoft Store version of Mini Bitva.
window.MiniConfig = {
  platform: "web",
  // Online play: the Title ID of your PlayFab title (developer.playfab.com → your title → the ID under its name,
  // 4–6 letters and digits, for example "1A2B3"). Empty: the game works, but "With friends" says online play is coming.
  playfabTitleId: "",
  // Optional relay (TURN) servers for players whose networks block direct connections, for example:
  // [{ urls: "turn:turn.example.com:3478", username: "name", credential: "password" }]
  iceServers: [],
};
