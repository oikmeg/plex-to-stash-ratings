import { promises as fs } from 'fs'
import { join } from 'path'
import { GraphQLClient, gql } from 'graphql-request'
import { parse, stringify } from 'csv'
import chalk from 'chalk'
import cliProgress from 'cli-progress'

// Types
// Type for the json file
type JsonFile = {
    data: {
        allScenes: {
            id: string
            path: string
            title: string
        }[]
    }
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

const main = async () => {
    const configFilePath = join(__dirname, 'config.json')
    // Make sure the config file exists
    try {
        await fs.access(configFilePath)
    } catch (error) {
        console.log(
            'Missing config.json. Please make sure you have config.json, plex.csv, and stash.json in the same directory as this script.'
        )
        process.exit(1)
    }

    const config: Config = JSON.parse(
        await fs.readFile(configFilePath, 'utf-8')
    )
    const jsonFilePath = join(__dirname, config.stash_json)
    const csvFilePath = join(__dirname, config.plex_csv)
    // Check that the required files exist and exit if they don't
    try {
        await fs.access(jsonFilePath)
        await fs.access(csvFilePath)
    } catch (error) {
        console.log(
            'Missing one or more required files. Please make sure you have config.json, plex.csv, and stash.json in the same directory as this script.'
        )
        process.exit(1)
    }

    // Create a graphql query for when a rating needs to be updated but not views
    const queryRating = gql`
        mutation SceneUpdate($id: ID!, $rating100: Int) {
            sceneUpdate(input: { id: $id, rating100: $rating100 }) {
                play_count
                rating100
            }
        }
    `

    // Create a graphql query for when views need to be updated but not rating
    const queryViews = gql`
        mutation SceneUpdate($id: ID!, $play_count: Int) {
            sceneUpdate(input: { id: $id, play_count: $play_count }) {
                play_count
                rating100
            }
        }
    `

    // GraphQL query to update the stash scene with the new ratings and views
    const queryAll = gql`
        mutation SceneUpdate($id: ID!, $rating100: Int, $play_count: Int) {
            sceneUpdate(
                input: {
                    id: $id
                    rating100: $rating100
                    play_count: $play_count
                }
            ) {
                play_count
                rating100
            }
        }
    `
    const jsonFile = await fs.readFile(jsonFilePath, 'utf-8')
    const csvFile = await fs.readFile(csvFilePath, 'utf-8')
    const json: JsonFile = JSON.parse(jsonFile)
    // use csv-parse to parse the csv file into an array, using delimiter | and escape character "
    const csv: CsvFile = await new Promise((resolve, reject) => {
        parse(csvFile, { delimiter: '|', escape: '"' }, (error, output) => {
            if (error) reject(error)
            resolve(output)
        })
    })

    // init the graphql client
    const client = new GraphQLClient(config.graphql_url, {
        headers: {
            ApiKey: `${config.graphql_api_key}`,
        },
    })
    const results: Results = []
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
    bar.start(csv.length, 0)

    csv.forEach(function (line, index) {
        // Update the progress bar
        bar.update(index + 1)
        const match = json.data.allScenes.find(
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
    // colorize the number of items to update red
    console.log(
        `Found ${chalk.red(
            itemsToUpdate.length
        )} items to update out of ${chalk.yellow(
            json.data.allScenes.length
        )} total scenes in Stash`
    )

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
    updateBar.start(itemsToUpdate.length, 0)

    // For each item to update
    for (const item of itemsToUpdate) {
        // Update the progress bar
        updateBar.update(results.length + 1)
        // Monitor time to update each scene
        const startTime = performance.now()
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

main()
