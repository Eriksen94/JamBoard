const express = require("express");
const UUID = require("uuid");
const bodyParser = require("body-parser");
const debug = false;
const app = express();

const http = require("http").Server(app);
const io = require("socket.io")(http);

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

let gamePort = process.env.PORT || 3000;

//By default, we forward the / path to index.html automatically.
app.get("/", function (req, res) {
  res.sendFile(__dirname + "/views/test.html");
});

app.get("/test", function (req, res) {
  console.log("get called");
  res.send("text string");
});

app.post("/test", function (req, res) {
  io.emit("socketCall", req.body);
  console.log("posted");
  res.sendStatus(200);
});

/* Socket.IO server set up. */

//Express and socket.io can work together to serve the socket.io client files for you.
//This way, when the client requests '/socket.io/' files, socket.io determines what the client needs.

//Create a socket.io instance using our express server
io.on("connection", () => {
  console.log("a user is connected)");
});

const server = http.listen(gamePort, () => {
  console.log("server is running on port", server.address().port);
});
