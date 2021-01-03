const express = require("express");
const UUID = require("uuid");
const bodyParser = require("body-parser");
const debug = false;
const app = express();
const crypto = require("crypto");

const http = require("http").Server(app);
const io = require("socket.io")(http);

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

let gamePort = process.env.PORT || 3000;

function Room(host){
  this.hostID = host;
  this.players = new Array();
}

let rooms = [];

//By default, we forward the / path to index.html automatically.
app.get("/", function (req, res) {
  res.sendFile(__dirname + "/views/home.html");
});

app.get("/lobby/:type/:joinID?", function (req, res) {
  res.sendFile(__dirname + "/views/game.html");
});

app.get("/test", function (req, res) {
  res.send("text string");
});

app.post("/host", function (req, res) {
  res.redirect("/lobby/host");
});

app.post("/join", function (req, res) {
  console.log(req.body);
  let requestedID = req.body.game_id;
  console.log(requestedID);
  res.redirect("/lobby/join" + requestedID);
});

app.post("/setup", function (req, res) {
  io.to(req.body.hostID).emit("call_setup", req.body);
  for(let i = 0; i < rooms.length; i++){
    if(rooms[i].hostID === req.body.hostID){
      io.to(req.body.hostID).emit("update_players", rooms[i].players);
    }
  }
  console.log(req.body);
  res.sendStatus(200);
});

app.post("/update", function (req, res) {
  io.to(req.body.hostID).emit("call_update", req.body);
  console.log(req.body);
  res.sendStatus(200);
});

//Create a socket.io instance using our express server
io.on("connection", (socket) => {
  console.log("a user is connected");

  //on connection give the user both a player id and host id
  let ids = {player: UUID.v4(), host: crypto.randomBytes(2).toString('hex')};
  socket.emit("on_connect", {player: ids.player, host: ids.host});
  console.log("assigned uuid: " + ids.player + " | game id: " + ids.host);

  //create a room on setup
  socket.on("host_setup", (id) => {
    console.log(id);
    socket.join(id.host);
    let r = new Room(id.host);
    r.players.push(id.player)
    rooms.push(r);
    console.log("hosted: " + id.host);
    console.log(rooms);
  });

  //join existing room or create new
  socket.on("join_lobby", (id) => {
    console.log(id);
    socket.join(id.join);
    console.log("joined: " + id.join);
    for(let i = 0; i < rooms.length; i++){
      if(rooms[i].hostID === id.join){
        socket.join(id.join);
        rooms[i].players.push(id.player);
        console.log(rooms);
        io.to(id.join).emit("player_joined", rooms[i].players.length);
        break;
      }
      else if( i === (rooms.length - 1)){
        //no match found by end of rooms search
        console.log("room not found");
        io.to(id.join).emit("send_home");
      }
    }
  
    socket.on('disconnecting', () => {
      console.log(socket.rooms); // the Set contains at least the socket ID
      if(socket.rooms.size > 1){
        let myArr = Array.from(socket.rooms)
        io.to(myArr[1]).emit("player_left");
      }
    });

  });

});

const server = http.listen(gamePort, () => {
  console.log("server is running on port", server.address().port);
});
