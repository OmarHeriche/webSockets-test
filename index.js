const express = require("express");
const { createServer } = require("node:http");
const { join } = require("node:path");
const { Server } = require("socket.io");
require("dotenv").config();
//todo import sqlite3 and open from sqlite
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const { availableParallelism } = require("node:os");
const cluster = require("node:cluster");
const { createAdapter, setupPrimary } = require("@socket.io/cluster-adapter");

if (cluster.isPrimary) {
    const numCPUs = availableParallelism();
    //! create one worker per available core
    for (let i = 0; i < numCPUs; i++) {
        cluster.fork({
            PORT: 3000 + i,
        });
    }

    //! set up the adapter on the primary thread
    return setupPrimary();
}

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
        // set up the adapter on each worker thread
        adapter: createAdapter(),
    });

    app.get("/", (req, res) => {
        res.sendFile(join(__dirname, "index.html"));
    });

    io.on("connection", async (socket) => {
        socket.on("chat message", async (msg, clientOffset, callback) => {
            //todo insert the message into the 'messages' table
            let result;
            try {
                result = await db.run(
                    "INSERT INTO messages (content, client_offset) VALUES (?, ?)",
                    msg,
                    clientOffset
                );
            } catch (e) {
                if (e.errno === 19 /* SQLITE_CONSTRAINT */) {
                    // the message was already inserted, so we notify the client
                    callback();
                } else {
                    // nothing to do, just let the client retry
                }
                return;
            }
            //! include the offset with the message
            console.log(socket.id);
            io.emit("chat message", msg, result.lastID);
            callback();
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

    const port = process.env.PORT;
    server.listen(port, () => {
        console.log(`server running at http://localhost:${port}`);
    });
};

main();
