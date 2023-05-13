import { promises as fs } from 'fs'
import { join } from 'path'
import { GraphQLClient, gql } from 'graphql-request'
import { parse, stringify } from 'csv'
import chalk from 'chalk'
import cliProgress from 'cli-progress'

// Types
// Type for the incoming json from stash
type StashJson = {
    allScenes: {
        id: string
        path: string
        play_count: number
        rating100: number
    }[]
}
// Type for the csv file
type CsvFile = string[][]
// Type for the results
type Results = {
    id: string
    path: string
    title: string
    views: string
    rating: string
    result: string
    error: string
}[]
// Type for the items to update
type ItemsToUpdate = {
    id: string
    path: string
    title: string
    views: string
    rating: string
}[]
// Type for the config file
type Config = {
    graphql_url: string
    graphql_api_key: string
    plex_csv: string
    stash_json: string
}

// Queries
// Create a graphql query for when a rating needs to be updated but not views
const queryRating = gql`
    mutation SceneUpdate($id: ID!, $rating100: Int) {
        sceneUpdate(input: { id: $id, rating100: $rating100 }) {
            rating100
            play_count
        }
    }
`
// Create a graphql query for when views need to be updated but not rating
const queryViews = gql`
    mutation SceneUpdate($id: ID!, $play_count: Int) {
        sceneUpdate(input: { id: $id, play_count: $play_count }) {
            rating100
            play_count
        }
    }
`
// GraphQL query to update the stash scene with the new ratings and views
const queryAll = gql`
    mutation SceneUpdate($id: ID!, $rating100: Int, $play_count: Int) {
        sceneUpdate(
            input: { id: $id, rating100: $rating100, play_count: $play_count }
        ) {
            rating100
            play_count
        }
    }
`
// Create a query to get all the scenes from stash and their id, path, rating, and play_count
const queryAllScenes = gql`
    query {
        allScenes {
            id
            path
            play_count
            rating100
        }
    }
`

// Setup Config
const configFilePath = join(__dirname, 'config.json')
// Make sure the config file exists
const checkConfigFile = async () => {
    try {
        await fs.access(configFilePath)
    } catch (error) {
        console.log(
            'Missing config.json. Please make sure you have config.json, plex.csv, and stash.json in the same directory as this script.'
        )
        process.exit(1)
    }
}
// Read the config file
const getConfig = async () => {
    await checkConfigFile()
    return JSON.parse(await fs.readFile(configFilePath, 'utf-8')) as Config
}

// init the graphql client
const graphQLClient = async (config: Config) => {
    return new GraphQLClient(config.graphql_url, {
        headers: {
            ApiKey: `${config.graphql_api_key}`,
        },
    })
}

const getAllScenes = async (client: GraphQLClient) => {
    // Console log that we are getting all the scenes from stash, this will take a while, and colorize it yellow
    console.log(
        `${chalk.yellow(
            'Getting all scenes from stash, this will take a while...'
        )}`
    )
    // Make the graphql request
    const json: StashJson = await client.request(queryAllScenes)
    // console log how many scenes were found, colorize the count green and the rest of the text yellow
    console.log(
        `${chalk.yellow('Found')} ${chalk.green(
            json.allScenes.length
        )} ${chalk.yellow('scenes')}`
    )
    // return the json
    return json
}

const matchItems = (stashScenes: StashJson, plexScenes: CsvFile) => {
    const itemsToUpdate: ItemsToUpdate = []

    // Create a progress bar with the total number of scenes to update
    const bar = new cliProgress.SingleBar(
        {
            format:
                'Matching items |' +
                chalk.green('{bar}') +
                '| {percentage}% || {value}/{total} Scenes || ETA: {eta_formatted}',
        },
        cliProgress.Presets.shades_classic
    )
    // Start the progress bar
    bar.start(plexScenes.length, 0)

    plexScenes.forEach(function (line, index) {
        // Update the progress bar
        bar.update(index + 1)
        const match = stashScenes.allScenes.find(
            (scene) => scene.path === line[0]
        )

        if (match) {
            const [path, title, views, rating] = line
            // If views or rating are not between 1-10 then skip
            if (
                (views && (parseInt(views) < 1 || parseInt(views) > 10)) ||
                (rating && (parseInt(rating) < 1 || parseInt(rating) > 10))
            )
                return
            // If play_count or rating100 are already equal to the new values then skip
            if (
                (views && parseInt(views) === match.play_count) ||
                (rating && parseInt(rating) * 10 === match.rating100)
            )
                return

            // Add the scene to the items to update array
            itemsToUpdate.push({
                id: match.id,
                path,
                title,
                views,
                rating,
            })
        }
    })
    // Stop the progress bar
    bar.stop()

    // Console log the number of items to update
    // colorize the number of items to update red, total scenes green, and the rest of the text yellow
    console.log(
        `${chalk.yellow('Found')} ${chalk.red(
            itemsToUpdate.length
        )} ${chalk.yellow('scenes to update out of')} ${chalk.green(
            stashScenes.allScenes.length
        )} ${chalk.yellow('total scenes')}`
    )

    return itemsToUpdate
}

const updateItems = async (client: GraphQLClient, items: ItemsToUpdate) => {
    if (items.length === 0) return []
    const results: Results = []

    // Make a progress bar for updating the scenes
    const updateBar = new cliProgress.SingleBar(
        {
            format:
                'Updating scenes |' +
                chalk.green('{bar}') +
                '| {percentage}% || {value}/{total} Scenes || ETA: {eta_formatted}',
        },
        cliProgress.Presets.shades_classic
    )

    // Start the progress bar
    updateBar.start(items.length, 0)

    // For each item to update
    for (const item of items) {
        // Update the progress bar
        updateBar.update(results.length + 1)
        // Find the right query to use
        const query =
            item.views && item.rating
                ? queryAll
                : item.views
                ? queryViews
                : queryRating
        // Create the variables for the query
        const variables = {
            id: item.id,
            rating100: item.rating ? parseInt(item.rating) * 10 : null,
            play_count: item.views ? parseInt(item.views) : null,
        }

        try {
            // Run the query
            const data = await client.request(query, variables)
            // Push the results to the results array
            results.push({
                id: item.id,
                path: item.path,
                title: item.title,
                views: item.views,
                rating: item.rating,
                result: JSON.stringify(data),
                error: '',
            })
        } catch (error) {
            // Push the error to the results array
            results.push({
                id: item.id,
                path: item.path,
                title: item.title,
                views: item.views,
                rating: item.rating,
                result: '',
                error: JSON.stringify(error),
            })
        }
    }
    // Stop the progress bar
    updateBar.stop()

    return results
}

const writeResults = async (results: Results) => {
    // use csv-generate to convert the results array into a csv file
    const csvResults = (await new Promise((resolve, reject) => {
        stringify(results, { header: true }, (error, output) => {
            if (error) reject(error)
            resolve(output)
        })
    })) as string

    await fs.writeFile('results.csv', csvResults)

    // Tell the user the results are in the results.csv file
    console.log(
        `Results are in the ${chalk.green(
            'results.csv'
        )} file in the current directory`
    )
}

const main = async () => {
    // Get the config
    const config = await getConfig()
    // Get the graphql client
    const client = await graphQLClient(config)
    const csvFilePath = join(__dirname, config.plex_csv)
    // Check that the required files exist and exit if they don't
    try {
        await fs.access(csvFilePath)
    } catch (error) {
        console.log(
            'Missing one or more required files. Please make sure you have config.json, plex.csv, and stash.json in the same directory as this script.'
        )
        process.exit(1)
    }

    const csvFile = await fs.readFile(csvFilePath, 'utf-8')
    // use csv-parse to parse the csv file into an array, using delimiter | and escape character "
    const csv: CsvFile = await new Promise((resolve, reject) => {
        parse(csvFile, { delimiter: '|', escape: '"' }, (error, output) => {
            if (error) reject(error)
            resolve(output)
        })
    })

    // Get the stash scenes
    const json = await getAllScenes(client)

    // Find the scenes that need to be updated
    const itemsToUpdate = matchItems(json, csv)

    // If there are no items to update then exit
    if (itemsToUpdate.length === 0) {
        console.log(`${chalk.green('No scenes to update, exiting...')}`)
        process.exit(0)
    }

    // Otherwise, start updating items
    const results = await updateItems(client, itemsToUpdate)

    // Write the results to a csv file
    await writeResults(results)

    // Exit the script
    process.exit(0)
}

main()
