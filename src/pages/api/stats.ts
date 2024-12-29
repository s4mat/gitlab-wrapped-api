import { NextResponse } from "next/server";
import { Gitlab } from "@gitbeaker/node";

export const runtime = "edge";

const GITLAB_TOKEN = process.env.GITLAB_TOKEN;
if (!GITLAB_TOKEN) {
  throw new Error("Missing GITLAB_TOKEN environment variable");
}

const GITLAB_URL = process.env.GITLAB_URL || "https://gitlab.sovagroup.one";

const gitlab = new Gitlab({
  host: GITLAB_URL,
  token: GITLAB_TOKEN,
});

interface ContributionDay {
    date: string;
    count: number;
}

interface GitLabStats {
  longestStreak: number;
  totalCommits: number;
  commitRank: string;
  calendarData: ContributionDay[];
  mostActiveDay: {
    name: string;
    commits: number;
  };
  mostActiveMonth: {
    name: string;
    commits: number;
  };
  starsEarned: number;
  topLanguages: string[];
}

/**
 * Determines the user's commit rank based on their total number of contributions
 * These thresholds are approximations based on general GitHub activity patterns
 */
function getCommitRank(totalCommits: number): string {
  if (totalCommits >= 5000) return "Top 0.5%-1%";
  if (totalCommits >= 2000) return "Top 1%-3%";
  if (totalCommits >= 1000) return "Top 5%-10%";
  if (totalCommits >= 500) return "Top 10%-15%";
  if (totalCommits >= 200) return "Top 25%-30%";
  if (totalCommits >= 50) return "Median 50%";
  return "Bottom 30%";
}

// Constants for date formatting
const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;


export default async function GET(request: Request): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const username = searchParams.get("username");

    if (!username) {
      return NextResponse.json(
        { error: "Username parameter is required" },
        { status: 400 }
      );
    }


   // Fetch user's data
   const user = await gitlab.Users.show(username);


 const userCommits = await gitlab.Users.getContributionStatistics(user.id)

    const contributionDays : ContributionDay[]= [];


    if (userCommits && userCommits.data && userCommits.data.contributions) {
      const commits = userCommits.data.contributions;

      for (const date in commits) {
         const count = commits[date];
         contributionDays.push({date, count})
      }
    }
    
    const currentYear = new Date().getFullYear();
    const filteredContributionDays = contributionDays.filter((day) => new Date(day.date).getFullYear() === currentYear);



  // Calculate monthly contribution statistics
 const monthlyCommits: Record<string, number> = {};
 filteredContributionDays.forEach((day: ContributionDay) => {
   const month = new Date(day.date).getMonth() + 1;
   const monthKey = month.toString().padStart(2, "0");
   monthlyCommits[monthKey] =
     (monthlyCommits[monthKey] || 0) + day.count;
 });



 // Calculate daily contribution patterns
 const dailyCommits: Record<number, number> = {};
 filteredContributionDays.forEach((day: ContributionDay) => {
     const dayOfWeek = new Date(day.date).getDay();
     dailyCommits[dayOfWeek] = (dailyCommits[dayOfWeek] || 0) + day.count;

 });


 // Find peak activity periods
 const [mostActiveMonth] = Object.entries(monthlyCommits).sort(
   ([, a], [, b]) => b - a
 );

 const [mostActiveDay] = Object.entries(dailyCommits).sort(
   ([, a], [, b]) => b - a
 );



    // Fetch repositories of the user
     const projects = await gitlab.Users.projects(user.id, {
        membership: true,
        order_by: 'stars_count',
        sort: 'desc',
        per_page: 100
     });


     let totalStars = 0;
     const languages: Record<string, number> = {};
     if(projects){
     for(const project of projects){
         if(project.star_count){
             totalStars += project.star_count;
         }

         if (project.programming_language){
             if (languages[project.programming_language]) {
                 languages[project.programming_language]++;
             } else {
                 languages[project.programming_language] = 1
             }
         }
     }
 }


 const topLanguages = Object.entries(languages)
 .sort(([, a], [, b]): number => (b as number) - (a as number))
 .slice(0, 3)
 .map(([lang]) => lang);



 // Calculate contribution streaks
 let currentStreak = 0;
 let maxStreak = 0;
 for (const day of filteredContributionDays) {
   if (day.count > 0) {
     currentStreak++;
     maxStreak = Math.max(maxStreak, currentStreak);
   } else {
     currentStreak = 0;
   }
 }
 const totalCommits = filteredContributionDays.reduce((acc, day) => acc + day.count, 0);


    const stats: GitLabStats = {
        longestStreak: maxStreak,
        totalCommits,
        commitRank: getCommitRank(totalCommits),
        calendarData: filteredContributionDays,
        mostActiveDay: {
            name: WEEKDAY_NAMES[parseInt(mostActiveDay[0])],
            commits: Math.round(mostActiveDay[1] / (filteredContributionDays.length / 7)), // Average per day
        },
        mostActiveMonth: {
            name: MONTH_NAMES[parseInt(mostActiveMonth[0]) - 1],
            commits: mostActiveMonth[1],
        },
        starsEarned: totalStars,
        topLanguages,
    };

   return NextResponse.json(stats);


  } catch (error: any) {
    console.error("Error fetching GitLab stats:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch GitLab statistics" },
      { status: 500 }
    );
  }
}