const express = require("express");
const { createServer } = require("node:http");
const { join } = require("node:path");
const { Server } = require("socket.io");
const { DMX, EnttecUSBDMXProDriver, NullDriver } = require("dmx-ts");
const { SerialPort } = require("serialport");
const fs = require("fs");

const readFile = (path, opts = "utf8") =>
  new Promise((resolve, reject) => {
    fs.readFile(path, opts, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });

const writeFile = (path, data, opts = "utf8") =>
  new Promise((resolve, reject) => {
    fs.writeFile(path, data, opts, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

const DMXServer = new DMX();

const app = express();
const server = createServer(app);
const io = new Server(server);

let channelTypes = [
  "dimmer",
  "red",
  "green",
  "blue",
  "white",
  "temp",
  "iris",
  "hue",
  "saturation",
  "brightness",
];
let channelAssignments = {};
let recalls = {};

app.get("/channels", (req, res) => {
  res.sendFile(join(__dirname, "channels.html"));
});
app.get("/recalls", (req, res) => {
  res.sendFile(join(__dirname, "recalls.html"));
});
app.get("/dimmers", (req, res) => {
  res.sendFile(join(__dirname, "dimmers.html"));
});
app.get("/controller", (req, res) => {
  res.sendFile(join(__dirname, "controller.html"));
});
app.get("/asset/rangetouch.js", (req, res) => {
  res.sendFile(join(__dirname, "rangetouch.js"));
});

server.listen(80, () => {
  console.log("Server started on port 3000.");
});

let mainUniverse = null;
let connected = false;

(async () => {
  try {
    let project = await readFile("./project.json");
    let json = JSON.parse(project);
    // channelTypes = json.channelTypes;
    channelAssignments = json.channelAssignments;
    recalls = json.recalls;

    console.log("Loaded project file.");
  } catch (e) {
    console.log("Unable to load project.");
  }
  console.log("Connecting to universe...");

  let connectTimer = setInterval(async () => {
    let ports = await SerialPort.list();
    for (let port of ports) {
      if (port.manufacturer == "ENTTEC") {
        console.log(port);
        if (!connected) {
          connected = true;
          clearInterval(connectTimer);
          mainUniverse = await DMXServer.addUniverse(
            "main",
            new EnttecUSBDMXProDriver(port.path)
          );

          console.log("Connected to", port.path, port.manufacturer);
        }
        // let mainUniverse = await DMXServer.addUniverse("main", new NullDriver());
        await io.emit("universe", DMXServer.universeToObject("main"));
      }
    }
  }, 500);
})();

async function saveProject() {
  return await writeFile(
    "./project.json",
    JSON.stringify({
      channelTypes,
      channelAssignments,
      recalls,
    })
  );
}

DMXServer.on("update", (e) => {
  // console.log(e);
});

io.on("connection", (socket) => {
  // socket.emit("universe", DMXServer.universeToObject("main"));
  socket.emit("universe", DMXServer.universeToObject("main"));
  socket.emit("recalls", Object.entries(recalls));
  socket.emit("channel-types", channelTypes);
  socket.emit("channel-assignments", channelAssignments);

  socket.on("set-channel", (msg) => {
    let channel = {};
    channel[`${parseInt(msg.channel)}`] = msg.value;
    socket.broadcast.emit("channel-update", channel);
    DMXServer.update("main", channel);
  });

  socket.on("set-channel-type", (msg) => {
    channelAssignments[`${msg.channel}`] = msg.value;
    io.emit("channel-assignments", channelAssignments);
    saveProject();
  });

  socket.on("remove-channel-type", (msg) => {
    delete channelAssignments[msg.channel];
    io.emit("channel-assignments", channelAssignments);
    saveProject();
  });

  socket.on("set-type", (msg) => {
    let channels = {};
    for (let [channel, type] of Object.entries(channelAssignments)) {
      if (msg.type == type) {
        channels[channel] = msg.value;
      }
    }

    socket.broadcast.emit("type-update", msg);
    io.emit("channel-update", channels);
    DMXServer.update("main", channels);
    // console.log(msg)
  });

  socket.on("save-recall", (msg) => {
    let updated = false;
    if (recalls[msg.name]) updated = true;
    recalls[msg.name] = {
      channels: msg.channels,
      color: msg.color,
    };
    io.emit("recalls", Object.entries(recalls));

    socket.emit("recall-saved", {
      updated,
      name: msg.name,
    });

    saveProject();
  });

  socket.on("remove-recall", (msg) => {
    delete recalls[msg];
    io.emit("recalls", Object.entries(recalls));

    saveProject();
  });

  socket.on("recall", (name) => {
    let recall = recalls[name];
    if (recall) {
      // console.log(recall)
      DMXServer.update("main", recall.channels);
      io.emit("channel-update", recall.channels);
      socket.broadcast.emit("recall-update", name);
    }
  });
});
