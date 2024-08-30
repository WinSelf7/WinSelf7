const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const app = express();
const bodyParser = require("body-parser");
const dotenv = require("dotenv");
const OpenAI = require("openai");
const { Client } = require('pg');
const axios = require('axios');
let PythonShellLibrary = require('python-shell');
let { PythonShell } = PythonShellLibrary;

dotenv.config();

app.use(cors({
    origin: '*'
}));
app.use(bodyParser.json({ limit: '5000mb' }));
app.use(bodyParser.urlencoded({ limit: '5000mb', extended: true }));
app.use(express.json());

const OPENAI_API_KEY = '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';
const openai = new OpenAI({
    apiKey: OPENAI_API_KEY,
});

const client = new Client({
    user: 'postgres',
    host: 'localhost',
    database: 'nyc',
    password: 'postgres',
    port: 5432,
});
client.connect((err) => {
    if (err) {
        console.error('Error connecting to the database:', err);
        return;
    }
    console.log('Connected to the database successfully');

});

function getDataFormat(data) {
    const dataFormat = [];

    function processData(obj, prefix = '') {
        for (const key in obj) {
            let fullKey = prefix ? `${prefix}.${key}` : key;
            if (typeof obj[key] === 'object' && obj[key] !== null) {
                if (Array.isArray(obj[key])) {
                    dataFormat.push({ key: fullKey, type: 'array' });
                } else {
                    processData(obj[key], fullKey);
                }
            } else {
                if (fullKey == 'id') fullKey = 'uid'
                dataFormat.push({ key: fullKey, type: typeof obj[key] });
            }
        }
    }

    processData(data);
    return dataFormat;
}
function createTableSchema(dataFormat, layerName) {
    console.log(layerName)
    let tableSchema = 'CREATE TABLE IF NOT EXISTS ' + layerName + ' (id SERIAL PRIMARY KEY, geom GEOMETRY';
    let insertColumns = 'geom';
    let insertValues = '$2';

    for (const { key, type } of dataFormat) {
        tableSchema += `, "${key}" TEXT`;
        insertColumns += `, "${key}"`;
        insertValues += ', JSON_EXTRACT_PATH_TEXT($1, \'' + key + '\')';
    }

    tableSchema += ');';
    const insertQuery = 'INSERT INTO parlor (' + insertColumns + ') VALUES (' + insertValues + ')';
    return { createTableQuery: tableSchema, insertTableQuery: insertQuery };
}
async function getToken() {
    let tokenString;
    let config = {
        method: 'get',
        maxBodyLength: Infinity,
        url: 'https://bs-api.geoneutron.com/v1.6/securityToken',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': '1247b934-01f7-490d-b939-c861853f57e0'
        }
    };

    try {
        const response = await axios.request(config);
        console.log(JSON.stringify(response.data));

        return new Promise((resolve, reject) => {
            let shell = new PythonShell('decode.py', {
                pythonOptions: ['-u'],
                args: [JSON.stringify(response.data.tempSecurityEncryptedToken)]
            });

            shell.on('message', (message) => {
                console.log('message', message);
                tokenString = message;
                resolve(tokenString);
            });

            shell.on('error', (err) => {
                reject(err);
            });
        });
    } catch (error) {
        console.log(error);
        return false;
    }
}

app.post("/chatapi", async (req, res) => {
    const { message, name, tableName } = req.body;

    let prompt = ""
    if (name == "Vessel") {
        prompt = `I am trying to create postgis sql from user natural language input. The input is as follows:` +
            message + `.
        
            As additional information,, table name is vessel, columns are id, geom, Timestamp, Vessel ID, Speed, Course, Status, Destination.
            Sometimes some columns has number values, But all are stored as Text format.
            Consider this case.
            And all columns value should be inputed with ''
            I don't need to get any description like "the SQL statement will be:" in your response.         
            Send me only sql statement. Exactly Only sql!!!`;
    }
    else if (name == "Parlor") {
        prompt = `I am trying to create postgis sql from user natural language input. The input is as follows:` +
            message + `.

    As additional information, table name is ${name}, columns are id, geom, source, name total_reviews, address, phone_number,business_hours, ethnicity, card_accepted, sauna, jacuzzi, 
    semi_truck_parking, thirt_minute_massage_price fourty_five_minutes_massage_price, sixty_minute_massage_price, user_review.
    Sometimes some columns has number values, But all are stored as Text format.
    Consider this case.
    And all columns value should be inputed with ''
    I don't need to get any description like "the SQL statement will be:" in your response.         
    Send me only sql statement. Exactly Only sql!!!`;
    }
    else {
        prompt = `I am trying to create postgis sql from user natural language input. The input is as follows:` +
            message + `.

    As additional information, table name is ${name}, columns are id, geom, event_id_cnty, event_date, year, time_precision, disorder_type, event_type, sub_event_type, actor1, assoc_actor_1,
    inter1, actor2, assoc_actor_2, inter2, interaction, civilian_targeting, iso, region, country, admin1, admin2, admin3, location, geo_precision, source, source_scale, notes, fatalities, tags, timestamp.
    Sometimes some columns has number values, But all are stored as Text format.
    Consider this case.
    And all columns value should be inputed with ''
    I don't need to get any description like "the SQL statement will be:" in your response.         
    Send me only sql statement. Exactly Only sql!!!`;
    }


    console.log(message)

    try {
        const completion = await openai.chat.completions.create({
            messages: [
                { role: "system", content: "You are a helpful assistant." },
                { role: "user", content: prompt },
            ],
            model: "gpt-4",
        });

        let response = completion.choices[0];
        console.log(response.message.content)

        client.query(response.message.content, async (err, result) => {
            if (err) {
                console.error('Error executing search query:', err);
                res.status(500).json({ error: 'Error executing search query' });
            } else {
                const rawPrompt =
                    JSON.stringify(result.rows) + `
                    make a beatuful text so that people can understand content of above json data. Addtionaly, this json data is based on below user input :`
                    + message +
                    `And I don't need any your description like metion about json. Only want to get beautiful text.`
                console.log(rawPrompt)
                const processText = await openai.chat.completions.create({
                    messages: [
                        { role: "system", content: "You are a helpful assistant." },
                        { role: "user", content: rawPrompt },
                    ],
                    model: "gpt-4",
                });
                console.log(processText.choices[0])
                res.status(200).json(processText.choices[0]);
            }
        });

        // res.send(response);
    } catch (error) {
        console.error("Error in /chat endpoint:", error);
        res.status(500).send("Error handling chat request");
    }
});

app.post("/assist", async (req, res) => {
    const { message } = req.body;
    console.log(message)
    try {
        const completion = await openai.chat.completions.create({
            messages: [
                { role: "system", content: "You are a helpful assistant." },
                { role: "user", content: message },
            ],
            model: "gpt-4",
        });

        let response = completion.choices[0];
        console.log(response.message.content)


        res.send(response);
    } catch (error) {
        console.error("Error in /chat endpoint:", error);
        res.status(500).send("Error handling chat request");
    }
});

app.post('/save-pg', (req, res) => {
    // Create a table to store GeoJSON data
    // Read the GeoJSON data from a file
    const geojsonFile = "C:/Work/Argos_Alpha/frontend/public/layers/Parlor.json";
    const geojsonData = JSON.parse(fs.readFileSync(geojsonFile, 'utf8'));
    // Insert the GeoJSON data into the table
    const dataFormat = getDataFormat(geojsonData.features[0].properties);

    const { name } = req.body;

    const { createTableQuery } = createTableSchema(dataFormat, name);

    client.query(createTableQuery, (err, res) => {
        if (err) {
            console.error('Error creating table:', err);
            client.end();
            return;
        }
        const { insertTableQuery } = createTableSchema(dataFormat);

        console.log(insertTableQuery)



        let cnt = 0
        for (const feature of geojsonData.features) {

            client.query(insertTableQuery, [JSON.stringify(feature.properties), JSON.stringify(feature.geometry)], (err, res) => {
                if (err) {
                    console.error('Error inserting feature:', err);
                } else {
                    cnt = cnt + 1;
                    console.log(cnt + "///" + geojsonData.features.length);
                }
            });
        }

    });
})
app.post('/save-json', (req, res) => {
    const { data, name } = req.body;

    const filePath = path.join(__dirname, '../frontend', '/public/', 'layers', `${name}.json`);
    console.log(filePath)
    fs.writeFile(filePath, JSON.stringify(data), (err) => {
        if (err) {
            console.error('Error saving JSON file:', err);
            res.status(500).json({ error: 'Error saving JSON file' });
        } else {
            res.status(200).json({ message: 'JSON file saved successfully' });
        }
    });
});
app.post('/load-json', (req, res) => {
    const { name } = req.body;
    const query = `SELECT * FROM ${name}`
    client.query(query, (err, result) => {
        if (err) {
            console.error('Error executing search query:', err);
            res.status(500).json({ error: 'Error executing search query' });
        } else {
            console.log((result.rows.length))
            res.status(200).json(result.rows);
        }
    });

});
app.post('/search-pg', (req, res) => {
    const { layerName, searchParams } = req.body;
    // Construct the SQL query based on the search parameters
    let query = `SELECT * FROM ${layerName} WHERE`;
    const values = [];


    for (const [key, value] of Object.entries(searchParams)) {
        query += ` ${key} LIKE $${values.length + 1} AND`;
        values.push(`%${value}%`);
    }
    
    // Remove the last 'AND' from the query
    query = query.slice(0, -4);
    console.log(query)
    client.query(query, values, (err, result) => {
        if (err) {
            console.error('Error executing search query:', err);
            res.status(500).json({ error: 'Error executing search query' });
        } else {
            res.status(200).json(result.rows);
        }
    });
});
app.get('/venntel/getTempSecurityToken', (req, res) => {

    let config = {
        method: 'get',
        maxBodyLength: Infinity,
        url: 'https://bs-api.geoneutron.com/v1.6/securityToken',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': '1247b934-01f7-490d-b939-c861853f57e0'
        }
    };

    axios.request(config)
        .then((response) => {
            console.log(JSON.stringify(response.data));

            let shell = new PythonShell('decode.py', {
                // The '-u' tells Python to flush every time
                pythonOptions: ['-u'],
                args: [JSON.stringify(response.data.tempSecurityEncryptedToken)]
            });
            shell.on('message', function (message) {
                console.log('message', message);
                res.send(message)
            })

            // res.send(JSON.stringify(response.data.tempSecurityEncryptedToken))
        })
        .catch((error) => {
            console.log(error);
            res.send(error)
        });
});
app.post('/venntel/locationData/search', async (req, res) => {
    let token = await getToken()
    const {sDate, eDate, geo}  = req.body
    console.log(sDate)
    console.log(eDate)
    console.log(geo)
    let data = JSON.stringify({
        "startDate": sDate,
        "endDate": eDate,
        // "areas": [
        //     {
        //         "longitude": -81.68797302246094,
        //         "latitude": 41.49641418457031,
        //         "radius": 100
        //     }
        // ]
        "polygons": geo,
    });

    let config = {
        method: 'post',
        maxBodyLength: Infinity,
        url: 'https://bs-api.geoneutron.com/v1.6/locationData/search',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': '1247b934-01f7-490d-b939-c861853f57e0',
            'TempSecurityToken': token
        },
        data: data
    };

    axios.request(config)
        .then((response) => {
            console.log(JSON.stringify(response.data));
            res.send(response.data)
        })
        .catch((error) => {
            res.send(error)
            console.log(error);
        });
});
app.listen(3001, () => {
    console.log('Server is running on port 3001');
});