# Road Trip Racing — แมพรถซิ่งเที่ยวทริป (Roblox) · เวอร์ชันเขียนใหม่

ถนนยาว 6,000 studs ผ่าน 5 โซน: **เมือง → ทุ่งหญ้า → ภูเขา → ชายหาด → แคมป์**
มีจุดเสกรถ แผ่นบูสต์ และเช็คพอยต์ 9 จุด + เส้นชัย แมพถูกสร้างจากสคริปต์ตอนกด Play

> ⚠️ ยังไม่ได้ทดสอบฟิสิกส์รถใน Studio จริง ค่าที่ปรับได้อยู่ใน `Config.lua` (`Config.CAR`)

## โครงสร้าง (ตำแหน่งใน Studio)
| ไฟล์ | อยู่ที่ | ชนิด |
|---|---|---|
| `src/server/RoadTrip.server.lua` | ServerScriptService, ชื่อ `RoadTrip` | Script |
| `src/server/RoadTrip/Config.lua` | ลูกของ `RoadTrip`, ชื่อ `Config` | ModuleScript |
| `.../Util.lua` `Roads.lua` `Props.lua` `Car.lua` `Gameplay.lua` | ลูกของ `RoadTrip` ชื่อตามไฟล์ | ModuleScript |
| `src/client/CarController.client.lua` | StarterPlayer ▸ StarterPlayerScripts, ชื่อ `CarController` | LocalScript |
| `src/client/RoadTripHUD.client.lua` | StarterPlayer ▸ StarterPlayerScripts, ชื่อ `RoadTripHUD` | LocalScript |

## ติดตั้งอัตโนมัติ (ผ่าน Claude Code + Studio MCP)
เปิด Studio (เทมเพลต Baseplate) ให้ MCP Server เป็นสีเขียว แล้วสั่ง Claude:

> ลบสคริปต์เก่าของโปรเจกต์นี้ใน Studio (ServerScriptService.RoadTripBuilder, StarterPlayerScripts.RoadTripHUD) แล้วติดตั้งชุดใหม่: ดาวน์โหลดไฟล์จาก https://raw.githubusercontent.com/xeem2541/-Game-Store/claude/eager-wozniak-n9brvl/roblox-road-trip/ ไปที่โฟลเดอร์ C:\Users\FONG\roadtrip2 แล้วสร้าง instance ใน Studio ตามตารางในโครงสร้างด้านบนโดยใส่โค้ดตรงตามต้นฉบับห้ามแก้ (ไฟล์: src/server/RoadTrip.server.lua, src/server/RoadTrip/{Config,Util,Roads,Props,Car,Gameplay}.lua, src/client/CarController.client.lua, src/client/RoadTripHUD.client.lua) เช็คจำนวนบรรทัดตรงต้นฉบับ แล้วกด Play รอ 25 วินาที อ่าน Output รายงาน error

## ติดตั้งด้วยมือ
สร้าง instance ตามตาราง แล้วคัดลอกโค้ดจากแต่ละไฟล์ไปวางทีละไฟล์ ลบโค้ดเริ่มต้นก่อนวาง
ใช้ Rojo ก็ได้: `rojo serve` (มี `default.project.json`)

## การเล่น
เดินไปที่แผ่นเขียวใกล้จุดเกิด กด `E` เสกรถ · `W/S` เร่ง/ถอย/เบรก · `A/D` เลี้ยว · แผ่นฟ้า = บูสต์
ตาย/รถตกแมพ/รถพลิกเกิน 4 วิ → กลับเช็คพอยต์ล่าสุด · ถึงเส้นชัยได้ `Trips +1`

## จูนค่ารถ (`Config.CAR`)
`MaxSpeed` ความเร็วสูงสุด · `Accel` อัตราเร่ง · `Grip` แรงเกาะข้าง (มาก = ไม่ไถล) · `TurnRate` ความไวเลี้ยว · `BoostMult/BoostTime/BoostKick` บูสต์
