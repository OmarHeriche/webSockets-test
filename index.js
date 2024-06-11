const express = require("express");
const { createServer } = require("node:http");
const { join } = require("node:path");
const { Server } = require("socket.io");
require("dotenv").config();
//todo import sqlite3 and open from sqlite
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");

const main = async () => {
    //! open the database file
    const db = await open({
        filename: "chat.db",
        driver: sqlite3.Database,
    });

    //! create our 'messages' table (you can ignore the 'client_offset' column for now)
    await db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_offset TEXT UNIQUE,
        content TEXT
    );
  `);

    const app = express();
    const server = createServer(app);
    const io = new Server(server, {
        connectionStateRecovery: {},
    });

    app.get("/", (req, res) => {
        res.sendFile(join(__dirname, "index.html"));
    });

    io.on("connection", async (socket) => {
        socket.on("chat message", async (msg) => {
            //todo insert the message into the 'messages' table
            let result;
            try {
                //! store the message in the database
                result = await db.run(
                    "INSERT INTO messages (content) VALUES (?)",
                    msg
                );
            } catch (e) {
                console.error(e);
                return;
            }
            //! include the offset with the message
            console.log("result", result);
            io.emit("chat message", msg, result.lastID);
        });
        if (!socket.recovered) {
            // if the connection state recovery was not successful
            try {
                await db.each(
                    "SELECT id, content FROM messages WHERE id > ?",
                    [socket.handshake.auth.serverOffset || 0],
                    (_err, row) => {
                        socket.emit("chat message", row.content, row.id);
                    }
                );
            } catch (e) {
                // something went wrong
            }
        }
    });

    const port = process.env.PORT || 3000;
    server.listen(port, () => {
        console.log(`server running at http://localhost:${port}`);
    });
};

main();
