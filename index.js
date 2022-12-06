const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const nodemailer = require('nodemailer');
const mg = require('nodemailer-mailgun-transport');


const jwt = require('jsonwebtoken');
const { query } = require('express');
require('dotenv').config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 5000;

const app = express();


// middleware
app.use(cors())
app.use(express.json());



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.nrl9whk.mongodb.net/?retryWrites=true&w=majority`;
console.log(uri)
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });


// function sendBookingEmail(booking){
//     const {email, treatment, appointmentDate, slot} = booking

//     const auth = {
//         auth: {
//           api_key: process.env.EMAIL_SEND_KEY,
//           domain: process.env.EMAIL_SEND_DOMAIN
//         }
//       }
//       const transporter = nodemailer.createTransport(mg(auth));
//     // let transporter = nodemailer.createTransport({
//     //     host: 'smtp.sendgrid.net',
//     //     port: 587,
//     //     auth: {
//     //         user: "apikey",
//     //         pass: process.env.SENDGRID_API_KEY
//     //     }
//     //  });
//      transporter.sendMail({
//         from: "mdiftekharhossainefat@gmail.com", // verified sender email
//         to: email, // recipient email
//         subject: `Your appointment for ${treatment} is confirmed`, // Subject line
//         text: "Hello world!", // plain text body
//         html: `<h3> Your appointment for is confirmed
//         <div>
//         <p>Your appointment for treatment: ${treatment}</p>
//         <p>Please visit us on ${appointmentDate} at ${slot}</p>
//         <p>Thanks from Doctors Portal.</p>
       
//         </div>
        
//         `,
//          // html body
//       }, function(error, info){
//         if (error) {
//           console.log('email send error',error);
//         } else {
//           console.log('Email sent: ' + info.response);
//         }
//       });
     
// }
function verifyJWT(req, res, next){
    // console.log('token inside verifyJWT', req.headers.authorization);
    const authHeader = req.headers.authorization;
    if(!authHeader){
        return res.status(401).send('unauthorized access');
    }
    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN, function(err, decoded){
        if(err){
            return res.status(403).send({message: 'forbidden access'})
        }
        req.decoded = decoded;
        next();
    })

}

async function run (){
    try{
       const appointmentOptionsCollection = client.db('doctorsPortal').collection('appointmentOptions');
       const bookingsCollection = client.db('doctorsPortal').collection('bookings');
       const usersCollection = client.db('doctorsPortal').collection('users');
       const doctorsCollection = client.db('doctorsPortal').collection('doctors');
       const paymentsCollection = client.db('doctorsPortal').collection('payments');

    //    make sure you use use verfyAdmin  after verifyjwt
       const verifyAdmin = async (req, res, next) =>{

        const decodedEmail = req.decoded.email;
        const query = {email: decodedEmail};
        const user = await usersCollection.findOne(query);
        if(user?.role !== 'admin'){
         return res.status(403).send({message: 'forbidden access'})
        }
            next();

       }
       app.get('/appointmentOptions', async(req, res)=>{
        const date = req.query.date;
        const query = {};
        const options = await appointmentOptionsCollection.find(query).toArray();

        // get the bookings of the provided date
        const bookingQuery = {appointmentDate: date}
        const alreadyBooked = await bookingsCollection.find(bookingQuery).toArray();

        // codeCarefully
        options.forEach(option => {
            const optionBooked = alreadyBooked.filter(book =>book.treatment === option.name);
            const bookedSlots = optionBooked.map(book => book.slot);

            const remainingSlots = option.slots.filter(slot => !bookedSlots.includes(slot))
            option.slots = remainingSlots;
        })
        res.send(options);
       });


       app.get('/v2/appointmentOptions', async(req, res) =>{
        const date = req.query.date;
        const options = await appointmentOptionsCollection.aggregate([
            {
                $lookup:{
                    from: 'bookings',
                    localField: 'name',
                    foreignField: 'treatment',
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $eq: ['$appointmentDate', date]
                                }
                            }
                        }
                     ],
                    as: 'booked'
                  }
            },
            {
                $project:{
                    name: 1,
                    price: 1,
                    slots: 1,
                    booked: {
                        $map: {
                            input: '$booked',
                            as: 'book',
                            in: '$$book.slot'
                        }
                    }
                }
            },
            {
                $project: {
                    name: 1,
                    price: 1,
                    slots: {
                        $setDifference: ['$slots', '$booked']
                    }
                }
            }
        ]).toArray();
        res.send(options);
       })

       app.get('/appointmentSpecialty', async(req, res) =>{
        const query = {}
        const result = await appointmentOptionsCollection.find(query).project({name: 1}).toArray();
        res.send(result);
       })
    // API Naming Convention
    // app.get('/bookings')
    // app.get('/bookings/:id')
    // app.post('/bookings')
    // app.patch('/bookings/:id')
    // app.delete('/bookings/:id')
   app.get('/bookings', verifyJWT, async (req, res) =>{
    const email = req.query.email;
    const decodedEmail = req.decoded.email;
    console.log(email, decodedEmail)

    if(email !== decodedEmail){
        return res.status(403).send({message: 'forbidden access'})
    }
   console.log('token', req.headers.authorization);
    const query = { email: email };
    const bookings = await bookingsCollection.find(query).toArray();
    res.send(bookings);
   });

   app.get('/bookings/:id', async (req, res) => {
    const id = req.params.id;
    const query = { _id: ObjectId(id) };
    const booking = await bookingsCollection.findOne(query);
    console.log(booking);
    res.send(booking);
   })


    //    bookings 
    app.post('/booking', async(req, res) =>{
        const booking = req.body
        console.log(booking);
        const query = {
            appointmentDate: booking.appointmentDate,
            email: booking.email,
            treatment: booking.treatment

        }

        const alreadyBooked = await bookingsCollection.find(query).toArray();
        if(alreadyBooked.length){
            const message = `you already have a booking on ${booking.appointmentDate}`
            return res.send({acknowledge: false, message})
        }
        const result = await bookingsCollection.insertOne(booking);
        //  send email about appointment cofirmation
        sendBookingEmail(booking);

        res.send(result);
    })

    app.post('/create-payment-intent', async (req, res) => {
        const booking = req.body;
        const price = booking.price;
        const amount = price * 100;

        const paymentIntent = await stripe.paymentIntents.create({
            currency: 'usd',
            amount: amount,
            "payment_method_types": [
                "card"
            ]
        });
        res.send({
            clientSecret: paymentIntent.client_secret,
          });

    });
    app.post('/payments', async (req, res) =>{
        const payment = req.body;
        const result = await paymentsCollection.insertOne(payment);
        const id = payment.bookingId 
        const filter = {_id: ObjectId(id)}
        const updatedDoc = {
            $set: {
                paid: true, 
                transactionId: payment.transactionId
            }
        }
        const updateResult = await bookingsCollection.updateOne(filter, updatedDoc)
        res.send(result);
    })
    app.get('/jwt', async(req, res) =>{
        const email = req.query.email;
        const query = {email: email};
        const user = await usersCollection.findOne(query);
        if(user){
            const token = jwt.sign({email}, process.env.ACCESS_TOKEN, {expiresIn: '1h'})
            return res.send({accessToken: token})
        }
        console.log(user);

        res.status(403).send({accessToken: ''})
    });
    app.get('/users', async(req, res) =>{
        const query = {};
        const users = await usersCollection.find(query).toArray();
        res.send(users);
    })
     app.get('/users/admin/:email', async(req, res) =>{
        const email = req.params.email;

        const query = {email}
        const user = await usersCollection.findOne(query);
        res.send({ isAdmin: user?.role === 'admin' });
     })

     
    app.post('/users', async(req, res) =>{
        const user = req.body;
        const result = await usersCollection.insertOne(user);
        res.send(result);
    });
    app.put('/users/admin/:id',verifyJWT, verifyAdmin, async (req, res) =>{
       
        const id = req.params.id;
        const filter = { _id: ObjectId(id) }
        const options = { upsert: true };
        const updatedDoc = {
            $set: {
                role: 'admin'
            }
        }
        const result = await usersCollection.updateOne(filter, updatedDoc, options);
        res.send(result);
    });

    // temporary to update price field on appointment options
    // app.get('/addPrice', async(req, res) =>{
    //     const filter = {}
    //     const options = { upsert: true }
    //     const updatedDoc = {
    //     $set: {
    //         price: 99
    //     }
    // }
    // const result = await appointmentOptionsCollection.updateMany(filter, updatedDoc, options)
    // res.send(result);
    // })
    app.get('/doctors', verifyJWT, verifyAdmin, async (req, res) =>{
        const query = {};
        const doctors = await doctorsCollection.find(query).toArray();
        res.send(doctors);
    })
    app.post('/doctors', verifyJWT, verifyAdmin, async(req, res) =>{
        const doctor = req.body;
         const result = await doctorsCollection.insertOne(doctor);
         res.send(result);
    })
    app.delete('/doctors/:id', verifyJWT, verifyAdmin, async(req, res) =>{
        const id = req.params.id;
        const filter = { _id: ObjectId(id) };
        const result = await doctorsCollection.deleteOne(filter);
        res.send(result);
    })

    }
    finally{
        
    }

}
  run().catch(console.log);


app.get('/', async(req, res) =>{
    res.send('doctors portal server is running');
})
app.listen(port, () => console.log(`Doctors portal running on ${port}`))