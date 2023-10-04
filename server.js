require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const app = express();
const multer = require('multer');
const fs = require('fs');
const csv = require('csv-parser');

const port = process.env.PORT || 3001;
const dbPath = process.env.DB_PATH || 'old_database.db';
const axios = require('axios');

const db = new sqlite3.Database(dbPath);
app.use(express.json());
app.use(cors());
const runQuery = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err); else resolve(rows);
        });
    });
};

const initializeDatabase = () => {
    const createCategoriesTable = `CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)`;
    const createProductsTable = `CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        model TEXT,
        capacity_ah REAL,
        cold_cranking_amps_en TEXT,
        length_mm REAL,
        width_mm REAL,
        height_mm REAL,
        weight_kg REAL,
        wholesale_price REAL,
        retail_price REAL,
        category_id INTEGER,
        photo TEXT,
        views INTEGER DEFAULT 0,
        FOREIGN KEY (category_id) REFERENCES categories (id)
    )`;
    // db.run("ALTER TABLE products ADD COLUMN views INTEGER DEFAULT 0", err => {
    //     if (err) {
    //         // Игнорируем ошибку, если колонка уже существует
    //         if (err.message !== "duplicate column name: views") {
    //             console.error("Ошибка при добавлении колонки 'views':", err);
    //         }
    //     }
    // });

    const createOrdersTable = `CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_name TEXT,
        customer_phone TEXT, 
        address TEXT,  
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`;

    const createOrderItemsTable = `CREATE TABLE IF NOT EXISTS order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER,
        product_id INTEGER,
        quantity INTEGER,
        FOREIGN KEY (order_id) REFERENCES orderДаs (id),
        FOREIGN KEY (product_id) REFERENCES products (id)
    )`;
    const createUsersTable = `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT
    )`;


    db.serialize(() => {
        db.run(createCategoriesTable);
        db.run(createProductsTable);
        db.run(createOrdersTable);
        db.run(createOrderItemsTable);
        db.run(createUsersTable);
    });
};

const upload = multer({ dest: 'uploads-csv/' });

app.post('/upload-csv', upload.single('file'), async (req, res) => {
    const filePath = req.file.path;

    fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', async (row) => {
            const {
                model,
                capacity_ah,
                cold_cranking_amps_en,
                length_mm,
                width_mm,
                height_mm,
                weight_kg,
                wholesale_price,
                retail_price,
                category_id,
                photo
            } = row;

            const sql = `
                INSERT INTO products (
                    model,
                    capacity_ah,
                    cold_cranking_amps_en,
                    length_mm,
                    width_mm,
                    height_mm,
                    weight_kg,
                    wholesale_price,
                    retail_price,
                    category_id,
                    photo
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            await runQuery(sql, [
                model,
                capacity_ah,
                cold_cranking_amps_en,
                length_mm,
                width_mm,
                height_mm,
                weight_kg,
                wholesale_price,
                retail_price,
                category_id,
                photo
            ]);
        })
        .on('end', () => {
            fs.unlinkSync(filePath);
            res.status(200).send('CSV файл успешно обработан');
        });
});
app.post('/add-category', async (req, res) => {
    try {
        const { name } = req.body; // Получаем имя категории из тела запроса
        if (!name) {
            return res.status(400).json({ error: 'Name is required' });
        }

        const insertSql = 'INSERT INTO categories (name) VALUES (?)';
        await new Promise((resolve, reject) => {
            db.run(insertSql, [name], function (err) {
                if (err) {
                    reject(err);
                } else {
                    resolve(this.lastID); // this.lastID содержит ID последней вставленной строки
                }
            });
        });

        res.status(201).json({ message: 'Category added successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


// Функция для генерации JWT
const generateAccessToken = (username) => {
    return jwt.sign({username}, process.env.ACCESS_TOKEN_SECRET, {expiresIn: '1800s'});
}


const send_message = async (message) => {
    const idInstance = '1101834631';
    const apiTokenInstance = 'f0aafa8020394baea4aa3db58aeb2afb02afca8b0e9b4ce4b5';
    const url = `https://api.green-api.com/waInstance${idInstance}/sendMessage/${apiTokenInstance}`;

    const payload = {
        chatId: `77771542668@c.us`, message: `${message}`
    };

    const headers = {
        'Content-Type': 'application/json'
    };

    try {
        const response = await axios.post(url, payload, {headers});
        console.log(response.data);
    } catch (error) {
        console.log(error);
    }
};

const composeAdminNotification = async (order_id) => {
    try {
        console.log(`Начинаем составление уведомления для заказа с ID: ${order_id}`);

        const [order] = await runQuery('SELECT * FROM orders WHERE id = ?', [order_id]);
        if (!order) {
            console.log(`Заказ с ID: ${order_id} не найден`);
        }

        const items = await runQuery('SELECT * FROM order_items WHERE order_id = ?', [order_id]);
        if (!items || items.length === 0) {
            console.log(`Товары для заказа с ID: ${order_id} отсутствуют`);
        }

        let totalRetailPrice = 0;
        let itemDetails = 'Отсутствуют';

        if (items && items.length > 0) {
            itemDetails = await Promise.all(items.map(async (item) => {
                const [product] = await runQuery('SELECT * FROM products WHERE id = ?', [item.product_id]);

                if (!product) {
                    console.log(`Продукт с ID: ${item.product_id} не найден`);
                    return `Консультация. Заказ: обратный звонок`;
                }

                totalRetailPrice += product.retail_price * item.quantity;
                return `${product.model} (Количество: ${item.quantity})`;
            }));

            itemDetails = itemDetails.join('\n    - ');
        }

        const message = `*Новый заказ: #${order ? order.id : 'Отсутствует'}* 🎉
*Имя*: ${order ? order.customer_name : 'Отсутствует'}
*Номер телефона*: ${order ? order.customer_phone : 'Отсутствует'}
*Адрес*: ${order ? order.address : 'Отсутствует'}
*Товары*: 
    - ${itemDetails}\n
*Общая стоимость*: ${totalRetailPrice}`;

        console.log("Сформированное сообщение:", message);

        await send_message(message);
        console.log("Уведомление админу отправлено успешно");
    } catch (err) {
        console.error("Ошибка при составлении уведомления:", err);
    }
};



app.post('/api/order', async (req, res) => {
    try {
        let {customer_name, customer_phone, address, items} = req.body;  // добавлены новые поля

        // Проверка на пустой массив items и добавление элемента "Консультация", если он пуст
        if (items.length === 0) {
            items = [{product_id: null, quantity: 1, name: 'Консультация'}];
        }

        const createOrderQuery = `INSERT INTO orders (customer_name, customer_phone, address) VALUES (?, ?, ?)`;  // обновлен запрос
        const {lastID} = await new Promise((resolve, reject) => {
            db.run(createOrderQuery, [customer_name, customer_phone, address], function (err) {  // обновлены параметры
                if (err) reject(err); else resolve(this);
            });
        });

        const insertItems = items.map(({product_id, quantity}) => {
            return new Promise((resolve, reject) => {
                const query = `INSERT INTO order_items (order_id, product_id, quantity) VALUES (?, ?, ?)`;
                db.run(query, [lastID, product_id, quantity], function (err) {
                    if (err) reject(err); else resolve(this);
                });
            });
        });

        await Promise.all(insertItems);
        // Отправка уведомления администратору
        await composeAdminNotification(lastID);

        res.send({message: 'Order created', orderId: lastID});
    } catch (err) {
        console.error("Ошибка при создании заказа:", err);  // Логирование ошибки
        res.status(400).send({error: err.message});
    }
});

// Маршрут для авторизации
app.post('/api/login', async (req, res) => {
    const {username, password} = req.body;
    if (username === "admin" && password === "admin") {
        const token = generateAccessToken(username);
        res.json({accessToken: token});
    } else {
        res.status(403).send({error: 'Invalid username or password'});
    }
});

// Middleware для проверки авторизации
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).send({error: 'Missing Token'});

    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, user) => {
        if (err) return res.status(403).send({error: 'Invalid Token'});
        req.user = user;
        next();
    });
}

// Получение всех заказов (только для авторизованных пользователей)
app.get('/api/orders', authenticateToken, async (req, res) => {
    try {
        const orders = await runQuery('SELECT * FROM orders');
        res.send({orders});
    } catch (err) {
        res.status(400).send({error: err.message});
    }
});

// Получение информации о конкретном заказе (только для авторизованных пользователей)
app.get('/api/order/:id', authenticateToken, async (req, res) => {
    const {id} = req.params;
    try {
        const [order] = await runQuery('SELECT * FROM orders WHERE id = ?', [id]);
        const items = await runQuery('SELECT * FROM order_items WHERE order_id = ?', [id]);
        res.send({order, items});
    } catch (err) {
        res.status(400).send({error: err.message});
    }
});

const attachCategories = async (req, res, next) => {
    try {
        const categories = await runQuery('SELECT id, name FROM categories');
        res.locals.categories = categories;
        next();
    } catch (err) {
        res.status(400).send({error: err.message});
    }
};

app.use(attachCategories); // Используем middleware
app.get('/api/products-retail', async (req, res) => {
    try {
        let sql = 'SELECT * FROM products WHERE retail_price IS NOT NULL';
        const params = [];
        const allowedFields = ['retail_price', 'capacity_ah', 'length_mm', 'width_mm', 'height_mm', 'weight_kg', 'category_id', 'min_retail_price', 'max_retail_price'];

        allowedFields.forEach(field => {
            if (req.query[field]) {
                if (field.startsWith('min_')) {
                    const actualField = field.substring(4);
                    sql += ` AND ${actualField} >= ?`;
                    params.push(parseFloat(req.query[field]));
                } else if (field.startsWith('max_')) {
                    const actualField = field.substring(4);
                    sql += ` AND ${actualField} <= ?`;
                    params.push(parseFloat(req.query[field]));
                } else {
                    sql += ` AND ${field} = ?`;
                    params.push(parseFloat(req.query[field]));
                }
            }
        });

        // Добавление логики сортировки
        const allowedSortFields = ['retail_price', 'model', 'views'];
        if (req.query.sort_by && allowedSortFields.includes(req.query.sort_by)) {
            sql += ` ORDER BY ${req.query.sort_by}`;
            if (req.query.order === 'desc') {
                sql += ' DESC';
            } else {
                sql += ' ASC';
            }
        }


        const filteredProducts = await runQuery(sql, params);

        const [categories] = await Promise.all([runQuery('SELECT id, name FROM categories')]);

        const filterOptions = allowedFields.reduce((acc, field) => {
            acc[field] = Array.from(new Set(filteredProducts.map(p => p[field])));
            return acc;
        }, {categories});
        console.log("SQL Query:", sql);
        console.log("SQL Params:", params);
        const products = await runQuery(sql, params);
        // console.log("Retrieved products:", products);
        res.send({products: filteredProducts, filterOptions});
    } catch (err) {
        res.status(400).send({error: err.message});
    }
});



app.get('/api/products-wholesale', async (req, res) => {
    try {
        let sql = 'SELECT * FROM products WHERE wholesale_price IS NOT NULL';
        const params = [];

        const allowedFields = [
            'wholesale_price', 'capacity_ah', 'length_mm',
            'width_mm', 'height_mm', 'weight_kg', 'category_id',
            'min_wholesale_price', 'max_wholesale_price'
        ];

        // Фильтрация
        allowedFields.forEach(field => {
            if (req.query[field]) {
                if (field.startsWith('min_')) {
                    const actualField = field.substring(4);
                    sql += ` AND ${actualField} >= ?`;
                    params.push(parseFloat(req.query[field]));
                } else if (field.startsWith('max_')) {
                    const actualField = field.substring(4);
                    sql += ` AND ${actualField} <= ?`;
                    params.push(parseFloat(req.query[field]));
                } else {
                    sql += ` AND ${field} = ?`;
                    params.push(parseFloat(req.query[field]));
                }
            }
        });

        // Сортировка
        const allowedSortFields = ['wholesale_price', 'model', 'views'];
        if (req.query.sort_by && allowedSortFields.includes(req.query.sort_by)) {
            sql += ` ORDER BY ${req.query.sort_by}`;
            if (req.query.order === 'desc') {
                sql += ' DESC';
            } else {
                sql += ' ASC';
            }
        }

        // Выполнение запроса
        const filteredProducts = await runQuery(sql, params);

        // Формирование опций для фильтра
        const [categories] = await Promise.all([runQuery('SELECT id, name FROM categories')]);
        const filterOptions = allowedFields.reduce((acc, field) => {
            acc[field] = Array.from(new Set(filteredProducts.map(p => p[field])));
            return acc;
        }, {categories});

        res.send({products: filteredProducts, filterOptions});
    } catch (err) {
        res.status(400).send({error: err.message});
    }
});

app.get('/api/categories', async (req, res) => {
    try {
        const categories = await runQuery('SELECT * FROM categories');
        res.send({categories});
    } catch (err) {
        res.status(400).send({error: err.message});
    }
});
app.get('/api/categories', async (req, res) => {
    try {
        const categories = await runQuery('SELECT * FROM categories');
        res.send({categories});
    } catch (err) {
        res.status(400).send({error: err.message});
    }
});

app.get('/api/product/:id', async (req, res) => {
    const {id} = req.params;
    try {
        // Получение информации о продукте
        const [product] = await runQuery('SELECT * FROM products WHERE id = ?', [id]);

        // Увеличение счетчика просмотров
        await runQuery('UPDATE products SET views = views + 1 WHERE id = ?', [id]);

        res.send({product});
    } catch (err) {
        res.status(400).send({error: err.message});
    }
});

app.get('/api/best-products', async (req, res) => {
    try {
        // Получение 4 наиболее просматриваемых продуктов
        const bestProducts = await runQuery('SELECT * FROM products ORDER BY views DESC LIMIT 4');

        res.send({bestProducts});
    } catch (err) {
        res.status(400).send({error: err.message});
    }
});


app.use('/api/uploads', express.static('uploads'));


app.get('/api/search', async (req, res) => {
    try {
        const {query} = req.query;
        if (!query) {
            return res.status(400).send({error: 'Query parameter is missing'});
        }

        const sql = `SELECT * FROM products WHERE model LIKE ?`;
        const products = await runQuery(sql, [`%${query}%`]);

        res.send({products});
    } catch (err) {
        res.status(400).send({error: err.message});
    }
});


initializeDatabase();

app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${port}`);
});

