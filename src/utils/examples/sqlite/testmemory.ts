import { KVDatabase } from "../../db/SqliteKVDB";

async function testMemoryDatabase() {
  console.log("开始测试内存数据库...");

  // 创建内存数据库实例
  const db = new KVDatabase();

  try {
    // 测试基本的增删改查操作
    console.log("1. 测试基本操作");

    // 添加数据
    await db.put("name", "张三");
    await db.put("age", 25);
    await db.put("hobbies", ["读书", "游泳"]);

    // 读取数据
    const name = await db.get<string>("name");
    console.log("获取name:", name); // 期望输出: 张三

    // 检查键是否存在
    const hasAge = await db.has("age");
    console.log("age键是否存在:", hasAge); // 期望输出: true

    // 获取所有键
    const keys = await db.keys();
    console.log("所有键:", keys); // 期望输出: ["name", "age", "hobbies"]

    // 获取所有键值对
    const allData = await db.getAll();
    console.log("所有数据:", allData);

    // 测试批量操作
    console.log("\n2. 测试批量操作");
    const entries: Array<[string, any]> = [
      ["user1", { name: "李四", age: 30 }],
      ["user2", { name: "王五", age: 28 }],
      ["user3", { name: "赵六", age: 35 }],
    ];

    await db.putMany(entries);
    console.log("批量添加用户数据成功");

    // 测试条件查询
    console.log("\n3. 测试条件查询");
    const youngUsers = await db.findByCondition(
      (value) => value.age && value.age < 30
    );
    console.log("30岁以下的用户:", youngUsers);

    // 测试值查询
    console.log("\n4. 测试值查询");
    const usersWithName = await db.findByValue("李四", false);
    console.log('包含"李四"的记录键:', usersWithName);

    // 测试删除操作
    console.log("\n5. 测试删除操作");
    await db.delete("name");
    const nameAfterDelete = await db.get("name");
    console.log("删除后查询name:", nameAfterDelete); // 期望输出: null

    // 获取记录数量
    const count = await db.count();
    console.log("当前记录数量:", count);
  } catch (error) {
    console.error("测试过程中出现错误:", error);
  } finally {
    // 关闭数据库连接
    await db.close();
    console.log("\n数据库连接已关闭");
  }
}

// 运行测试
testMemoryDatabase().catch(console.error);
